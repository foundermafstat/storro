import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  codexEvidenceDisclaimer,
  getExtractionFactCodexProvenance,
  markGitHubContextAsCodexAssisted,
} from "@/services/codex-evidence-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let sourceId = "";
let factId = "";
let context: ScopedContext;

describe("codex evidence service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `codex-user-${suffix}`,
        email: `codex-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Codex Org ${suffix}`,
        slug: `codex-org-${suffix}`,
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
      name: `Codex Project ${suffix}`,
    });
    const extractionRun = await prisma.extractionRun.create({
      data: {
        orgId,
        projectId: project.id,
        createdById: userId,
        status: "COMPLETED",
        selectedSourceIds: [],
      },
    });
    const source = await prisma.sourceDocument.create({
      data: {
        orgId,
        projectId: project.id,
        createdById: userId,
        sourceType: "GITHUB_PULL_REQUEST",
        status: "CREATED",
        title: "PR #7 Add generation",
        rawText: "Repository PR evidence",
        metadata: {
          github: {
            pullRequest: { number: 7 },
          },
        },
      },
    });
    const fact = await prisma.extractionFact.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: extractionRun.id,
        category: "implementation",
        text: "Generation was implemented in PR #7.",
        sourceIds: [source.id],
        filePaths: [],
        confidence: 0.9,
        reviewStatus: "APPROVED",
      },
    });

    projectId = project.id;
    sourceId = source.id;
    factId = fact.id;
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

  it("marks imported GitHub context as Codex-assisted with user notes", async () => {
    const result = await markGitHubContextAsCodexAssisted(context, {
      projectId,
      sourceDocumentIds: [sourceId],
      summary: "Codex helped draft and refine the implementation.",
      prompts: ["Implement artifact generation."],
      decisions: ["Keep evidence grounded in GitHub PR data."],
      fixes: ["Resolved type errors."],
      pullRequestNumbers: [7],
      branchNames: ["main"],
    });
    const source = await prisma.sourceDocument.findUniqueOrThrow({
      where: {
        id: sourceId,
      },
    });

    expect(source.tags).toContain("codex-assisted");
    expect(source.metadata).toMatchObject({
      codexEvidence: {
        classification: "CODEX_ASSISTED",
        evidenceBasis: "repository_data_and_user_notes",
        noHiddenAccessClaim: true,
      },
    });
    expect(result.note.sourceType).toBe("CODEX_NOTE");
  });

  it("preserves Codex source provenance for extraction facts", async () => {
    const provenance = await getExtractionFactCodexProvenance(context, {
      projectId,
      factId,
    });

    expect(provenance).toHaveLength(1);
    expect(provenance[0].codexEvidence).toMatchObject({
      classification: "CODEX_ASSISTED",
    });
  });

  it("does not claim automatic private Codex access", () => {
    expect(codexEvidenceDisclaimer.toLowerCase()).not.toContain("automatic private codex access");
    expect(codexEvidenceDisclaimer.toLowerCase()).not.toContain("hidden codex access");
    expect(codexEvidenceDisclaimer).toContain("repository evidence");
  });
});
