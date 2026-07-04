import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createProject } from "@/services/project-service";
import {
  getRedactedSourceTextForAi,
  redactSourceDocument,
} from "@/services/redaction-service";
import type { ScopedContext } from "@/services/scoped-context";
import { createSourceDocument } from "@/services/source-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

describe("redaction persistence", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `redaction-user-${suffix}`,
        email: `redaction-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Redaction Org ${suffix}`,
        slug: `redaction-org-${suffix}`,
      },
    });

    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };

    await prisma.membership.create({
      data: {
        orgId,
        userId,
        role: "OWNER",
      },
    });

    const project = await createProject(context, {
      name: `Redaction Project ${suffix}`,
    });

    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: orgId,
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: userId,
      },
    });
    await prisma.$disconnect();
  });

  it("persists visible reports and returns redacted text to AI jobs", async () => {
    const fakeSecret = "api_key=" + "z".repeat(20);
    const source = await createSourceDocument(context, {
      projectId,
      title: "Source with generic secret",
      body: `Keep the finding but redact ${fakeSecret}`,
      sourceType: "MANUAL_NOTE",
    });

    const { report, result } = await redactSourceDocument(context, source.id);

    expect(result.blocked).toBe(false);
    expect(report.redactedText).toContain("[REDACTED_SECRET_ASSIGNMENT]");
    expect(report.redactedText).not.toContain(fakeSecret);

    const updatedSource = await prisma.sourceDocument.findUniqueOrThrow({
      where: {
        id: source.id,
      },
    });

    expect(updatedSource.status).toBe("REDACTED");
    expect(updatedSource.metadata).toMatchObject({
      redaction: {
        reportId: report.id,
        blocked: false,
        findings: 1,
      },
    });

    const aiText = await getRedactedSourceTextForAi(context, source.id);
    expect(aiText).toBe(report.redactedText);
    expect(aiText).not.toContain(fakeSecret);
  });

  it("blocks AI processing for private keys", async () => {
    const privateKey = "-----BEGIN " + "PRIVATE KEY-----\nabc\n-----END " + "PRIVATE KEY-----";
    const source = await createSourceDocument(context, {
      projectId,
      title: "Blocked private key",
      body: privateKey,
      sourceType: "MANUAL_NOTE",
    });

    const { result } = await redactSourceDocument(context, source.id);

    expect(result.blocked).toBe(true);
    await expect(getRedactedSourceTextForAi(context, source.id)).rejects.toThrow(
      "Source is blocked by redaction review.",
    );
  });
});
