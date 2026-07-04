import { createHash } from "crypto";
import type { GroundingState, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertOrgPermission, assertProjectPermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { redactText } from "@/services/redaction-service";
import { storyPlanSchema } from "@/services/story-planning-service";
import { getTemplateDefinition, type TemplateDefinition } from "@/services/template-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

type GroundingSeverity = "low" | "medium" | "high" | "critical";

export type GroundingIssue = {
  type:
    | "secret_leak"
    | "unsupported_claim"
    | "invented_metric"
    | "invented_integration"
    | "generic_phrase"
    | "overclaiming"
    | "missing_section";
  severity: GroundingSeverity;
  message: string;
  evidence?: string;
};

export type GroundingReviewResult = {
  state: GroundingState;
  issues: GroundingIssue[];
  autoRevisions: string[];
  reviewedAt: string;
};

const reviewJobPayloadSchema = z.object({
  artifactId: z.string().uuid(),
});

const genericPhraseReplacements: Record<string, string> = {
  "cutting-edge": "current",
  "game-changing": "meaningful",
  "game changer": "meaningful change",
  seamlessly: "directly",
  "robust and scalable": "reliable",
  revolutionary: "notable",
  "unlock the power": "use",
};

const overclaimingPatterns = [
  "production-ready",
  "fully automated",
  "guaranteed",
  "zero downtime",
  "best-in-class",
  "revolutionary",
];

const knownIntegrations = [
  "Clerk",
  "GitHub App",
  "Stripe",
  "Supabase",
  "Vercel",
  "AWS",
  "S3",
  "R2",
  "Redis",
  "Postgres",
  "OpenAI",
  "NextAuth",
];

export async function enqueueGroundingReview(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);
  await getScopedArtifact(context, input.projectId, input.artifactId, db);

  return db.job.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      type: "GROUNDING_REVIEW",
      status: "QUEUED",
      queueName: "grounding-review",
      payload: {
        artifactId: input.artifactId,
      },
    },
  });
}

export async function executeGroundingReviewJob(
  context: ScopedContext,
  input: {
    jobId: string;
    projectId?: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "artifact.write", db);

  const job = await db.job.findFirst({
    where: {
      id: input.jobId,
      orgId: context.orgId,
      projectId: input.projectId,
      type: "GROUNDING_REVIEW",
    },
  });

  if (!job) {
    throw new NotFoundError("Grounding review job not found.");
  }

  if (!job.projectId) {
    throw new ValidationServiceError("Grounding review job must be project-scoped.");
  }

  const payload = reviewJobPayloadSchema.parse(job.payload);

  await db.job.update({
    where: {
      id: job.id,
    },
    data: {
      status: "RUNNING",
      attempts: {
        increment: 1,
      },
      lockedAt: new Date(),
    },
  });

  try {
    const result = await reviewArtifactGrounding(
      context,
      {
        projectId: job.projectId,
        artifactId: payload.artifactId,
        jobId: job.id,
      },
      db,
    );
    const completed = await db.job.update({
      where: {
        id: job.id,
      },
      data: {
        status: "COMPLETED",
        result: result.review as unknown as Prisma.InputJsonObject,
      },
    });

    return {
      job: completed,
      review: result.review,
      artifact: result.artifact,
    };
  } catch (error) {
    await db.job.update({
      where: {
        id: job.id,
      },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Grounding review failed.",
      },
    });

    throw error;
  }
}

export async function reviewArtifactGrounding(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
    jobId?: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);

  const artifact = await getScopedArtifact(context, input.projectId, input.artifactId, db);
  const storyRun = await db.storyRun.findFirst({
    where: {
      id: artifact.storyRunId,
      orgId: context.orgId,
      projectId: input.projectId,
    },
  });

  if (!storyRun) {
    throw new NotFoundError("Story plan not found.");
  }

  const template = await getTemplateDefinition(
    context,
    {
      projectId: input.projectId,
      templateId: storyRun.templateId,
    },
    db,
  );
  const factIds = resolveInputFactIds(artifact.metadata, storyRun.storyPlan);
  const facts = await db.extractionFact.findMany({
    where: {
      id: {
        in: factIds,
      },
      orgId: context.orgId,
      projectId: input.projectId,
      reviewStatus: "APPROVED",
    },
  });
  const reviewed = runGroundingChecks(artifact.contentMarkdown, template, facts.map((fact) => fact.text));
  const revised = maybeAutoReviseMinorIssues(artifact.contentMarkdown, reviewed);
  const finalReview = revised.markdown === artifact.contentMarkdown
    ? reviewed
    : runGroundingChecks(revised.markdown, template, facts.map((fact) => fact.text));
  const recordedIssues = dedupeIssues([
    ...finalReview.issues,
    ...(revised.autoRevisions.length > 0
      ? reviewed.issues.filter((issue) => issue.type === "generic_phrase")
      : []),
  ]);
  const review: GroundingReviewResult = {
    state: resolveGroundingState(recordedIssues),
    issues: recordedIssues,
    autoRevisions: revised.autoRevisions,
    reviewedAt: new Date().toISOString(),
  };
  const updatedMetadata = {
    ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
    groundingReview: {
      ...review,
      jobId: input.jobId,
      factIds,
    },
  };
  const updatedArtifact = await db.storyArtifact.update({
    where: {
      id: artifact.id,
    },
    data: {
      contentMarkdown: revised.markdown,
      groundingState: review.state,
      status: review.state === "FAILED" ? "REVIEW_REQUIRED" : "EXPORT_READY",
      metadata: updatedMetadata as Prisma.InputJsonObject,
    },
  });

  if (revised.markdown !== artifact.contentMarkdown) {
    await db.editorRevision.create({
      data: {
        orgId: context.orgId,
        projectId: input.projectId,
        artifactId: artifact.id,
        authorId: context.userId,
        contentMarkdown: revised.markdown,
        contentHash: hashMarkdown(revised.markdown),
        groundingState: review.state,
      },
    });
  }

  return {
    artifact: updatedArtifact,
    review,
  };
}

export async function assertArtifactExportReady(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.read", db);

  const artifact = await getScopedArtifact(context, input.projectId, input.artifactId, db);

  if (artifact.groundingState === "FAILED" || artifact.status !== "EXPORT_READY") {
    throw new ValidationServiceError("Artifact is not export-ready because grounding review failed or is incomplete.", {
      artifactId: artifact.id,
      status: artifact.status,
      groundingState: artifact.groundingState,
    });
  }

  return artifact;
}

function runGroundingChecks(markdown: string, template: TemplateDefinition, factTexts: string[]) {
  const issues: GroundingIssue[] = [
    ...detectSecretLeaks(markdown),
    ...detectInventedMetrics(markdown, factTexts),
    ...detectInventedIntegrations(markdown, factTexts),
    ...detectOverclaiming(markdown, factTexts),
    ...detectGenericPhrases(markdown),
    ...detectMissingSections(markdown, template),
    ...detectUnsupportedClaims(markdown, factTexts),
  ];

  return {
    issues: dedupeIssues(issues),
  };
}

function detectSecretLeaks(markdown: string): GroundingIssue[] {
  const redaction = redactText(markdown);

  return redaction.findings.map((finding) => ({
    type: "secret_leak",
    severity: finding.severity === "critical" || finding.severity === "high" ? "critical" : "high",
    message: `${finding.label} must not appear in generated artifacts.`,
    evidence: finding.replacement,
  }));
}

function detectInventedMetrics(markdown: string, factTexts: string[]): GroundingIssue[] {
  const factCorpus = factTexts.join("\n");
  const metrics = markdown.match(/\b(?:\$?\d+(?:\.\d+)?(?:%|x|k|m| users| customers| revenue| ARR| MRR)?)\b/gi) ?? [];

  return [...new Set(metrics)]
    .filter((metric) => !factCorpus.includes(metric))
    .map((metric) => ({
      type: "invented_metric",
      severity: "high",
      message: "Generated metric is not present in approved facts.",
      evidence: metric,
    }));
}

function detectInventedIntegrations(markdown: string, factTexts: string[]): GroundingIssue[] {
  const factCorpus = factTexts.join("\n").toLowerCase();
  const markdownLower = markdown.toLowerCase();

  return knownIntegrations
    .filter((integration) => markdownLower.includes(integration.toLowerCase()) && !factCorpus.includes(integration.toLowerCase()))
    .map((integration) => ({
      type: "invented_integration",
      severity: "high",
      message: "Generated integration is not grounded in approved facts.",
      evidence: integration,
    }));
}

function detectOverclaiming(markdown: string, factTexts: string[]): GroundingIssue[] {
  const factCorpus = factTexts.join("\n").toLowerCase();
  const markdownLower = markdown.toLowerCase();

  return overclaimingPatterns
    .filter((phrase) => markdownLower.includes(phrase) && !factCorpus.includes(phrase))
    .map((phrase) => ({
      type: "overclaiming",
      severity: "high",
      message: "Generated artifact uses an overclaim not supported by approved facts.",
      evidence: phrase,
    }));
}

function detectGenericPhrases(markdown: string): GroundingIssue[] {
  const markdownLower = markdown.toLowerCase();

  return Object.keys(genericPhraseReplacements)
    .filter((phrase) => markdownLower.includes(phrase))
    .map((phrase) => ({
      type: "generic_phrase",
      severity: "low",
      message: "Generated artifact contains a generic AI-style phrase.",
      evidence: phrase,
    }));
}

function detectMissingSections(markdown: string, template: TemplateDefinition): GroundingIssue[] {
  const normalized = markdown.toLowerCase();

  return template.requiredSections
    .filter((section) => !normalized.includes(section.toLowerCase()))
    .map((section) => ({
      type: "missing_section",
      severity: "medium",
      message: "Generated artifact is missing a required template section.",
      evidence: section,
    }));
}

function detectUnsupportedClaims(markdown: string, factTexts: string[]): GroundingIssue[] {
  const factTokens = new Set(tokenize(factTexts.join(" ")));

  return extractClaimSentences(markdown)
    .filter((claim) => hasClaimSignal(claim))
    .filter((claim) => claimSupportScore(claim, factTokens) < 2)
    .map((claim) => ({
      type: "unsupported_claim",
      severity: "high",
      message: "Generated claim is not grounded in approved facts.",
      evidence: claim,
    }));
}

function maybeAutoReviseMinorIssues(markdown: string, review: { issues: GroundingIssue[] }) {
  if (review.issues.some((issue) => issue.severity === "high" || issue.severity === "critical")) {
    return {
      markdown,
      autoRevisions: [],
    };
  }

  let revised = markdown;
  const autoRevisions: string[] = [];

  for (const [phrase, replacement] of Object.entries(genericPhraseReplacements)) {
    const pattern = new RegExp(escapeRegExp(phrase), "gi");

    if (pattern.test(revised)) {
      revised = revised.replace(pattern, replacement);
      autoRevisions.push(`Replaced generic phrase "${phrase}".`);
    }
  }

  return {
    markdown: revised,
    autoRevisions,
  };
}

function resolveGroundingState(issues: GroundingIssue[]): GroundingState {
  if (issues.some((issue) => issue.severity === "critical" || issue.severity === "high")) {
    return "FAILED";
  }

  if (issues.length > 0) {
    return "WARNINGS";
  }

  return "PASSED";
}

function resolveInputFactIds(metadata: Prisma.JsonValue, storyPlan: Prisma.JsonValue | null) {
  if (isRecord(metadata) && Array.isArray(metadata.inputFactIds)) {
    return metadata.inputFactIds.filter((value): value is string => typeof value === "string");
  }

  const parsed = storyPlanSchema.safeParse(storyPlan);

  if (!parsed.success) {
    return [];
  }

  return [...new Set([...parsed.data.factsToUse, ...parsed.data.sections.flatMap((section) => section.factIds)])];
}

async function getScopedArtifact(
  context: ScopedContext,
  projectId: string,
  artifactId: string,
  db: DatabaseClient,
) {
  const artifact = await db.storyArtifact.findFirst({
    where: {
      id: artifactId,
      orgId: context.orgId,
      projectId,
      archivedAt: null,
    },
  });

  if (!artifact) {
    throw new NotFoundError("Artifact not found.");
  }

  return artifact;
}

function extractClaimSentences(markdown: string) {
  return markdown
    .replace(/^#+\s+/gm, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/^[-*]\s+/, "").trim())
    .filter((sentence) => sentence.length >= 24);
}

function hasClaimSignal(sentence: string) {
  return /\b(is|are|was|were|has|have|had|ships?|adds?|supports?|integrates?|stores?|generates?|blocks?|creates?|enables?|improves?|launches?|launched)\b/i.test(sentence);
}

function claimSupportScore(claim: string, factTokens: Set<string>) {
  return tokenize(claim).filter((token) => factTokens.has(token)).length;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3)
    .filter((token) => !["that", "with", "from", "this", "into", "only", "when", "then", "they", "their"].includes(token));
}

function dedupeIssues(issues: GroundingIssue[]) {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.type}:${issue.evidence ?? issue.message}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function hashMarkdown(markdown: string) {
  return createHash("sha256").update(markdown).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
