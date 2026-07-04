import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createStructuredManualNote } from "@/services/manual-note-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";
import { createSourceDocument, selectSourceDocumentsForExtraction } from "@/services/source-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

describe("structured manual notes", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `manual-user-${suffix}`,
        email: `manual-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Manual Org ${suffix}`,
        slug: `manual-org-${suffix}`,
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
      name: `Manual Project ${suffix}`,
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

  it("creates private structured daily build notes and ranks them first for extraction", async () => {
    const imported = await createSourceDocument(context, {
      projectId,
      title: "Imported ChatGPT note",
      body: "Imported source.",
      sourceType: "CHATGPT_EXPORT",
      provenance: {
        kind: "chatgpt",
      },
    });
    const manual = await createStructuredManualNote(context, {
      projectId,
      title: "Daily build journal",
      kind: "daily_journal",
      whatTried: "Built project source CRUD.",
      whatWorked: "Scoped service tests passed.",
      whatFailed: "Initial route glob needed quoting.",
      filesTouched: ["services/source-service.ts", "tests/integration/source-document-crud.test.ts"],
      nextStep: "Continue redaction stage.",
      publicSummary: "Source CRUD landed.",
      privateNotes: "Keep rollout details private.",
    });

    expect(manual.isPrivate).toBe(true);
    expect(manual.rawText).toContain("## What was tried");
    expect(manual.rawText).toContain("services/source-service.ts");
    expect(manual.metadata).toMatchObject({
      manualNote: {
        kind: "daily_journal",
        hasPrivateNotes: true,
        rankingBoost: 50,
      },
    });

    const selected = await selectSourceDocumentsForExtraction(context, {
      projectId,
      sourceIds: [imported.id, manual.id],
    });

    expect(selected.map((source) => source.id)).toEqual([manual.id, imported.id]);
  });
});
