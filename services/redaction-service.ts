import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertSourcePermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type RedactionSeverity = "low" | "medium" | "high" | "critical";

export type RedactionFinding = {
  type: string;
  severity: RedactionSeverity;
  label: string;
  start: number;
  end: number;
  replacement: string;
  requiresReview: boolean;
};

export type RedactionResult = {
  redactedText: string;
  findings: RedactionFinding[];
  blocked: boolean;
  requiresReview: boolean;
};

type RedactionRule = {
  type: string;
  label: string;
  severity: RedactionSeverity;
  pattern: RegExp;
  replacement: string;
  blockAi: boolean;
};

const redactionRules: RedactionRule[] = [
  {
    type: "openai_key",
    label: "OpenAI API key",
    severity: "critical",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED_OPENAI_KEY]",
    blockAi: true,
  },
  {
    type: "github_token",
    label: "GitHub token",
    severity: "critical",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
    blockAi: true,
  },
  {
    type: "jwt",
    label: "JWT",
    severity: "high",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED_JWT]",
    blockAi: false,
  },
  {
    type: "private_key",
    label: "Private key",
    severity: "critical",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
    blockAi: true,
  },
  {
    type: "database_url",
    label: "Database URL",
    severity: "critical",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`<>]+/gi,
    replacement: "[REDACTED_DATABASE_URL]",
    blockAi: true,
  },
  {
    type: "seed_phrase",
    label: "Seed phrase",
    severity: "critical",
    pattern: /\b(?:seed phrase|mnemonic)\s*[:=]\s*(?:[a-z]+[\s,]+){11,23}[a-z]+\b/gi,
    replacement: "[REDACTED_SEED_PHRASE]",
    blockAi: true,
  },
  {
    type: "oauth_secret",
    label: "OAuth secret",
    severity: "high",
    pattern: /\b(?:oauth|client|webhook|stripe|github|auth)[_-]?(?:secret|token)\s*[:=]\s*["']?[^"'\s]{12,}/gi,
    replacement: "[REDACTED_SECRET_ASSIGNMENT]",
    blockAi: false,
  },
  {
    type: "generic_secret_assignment",
    label: "Generic secret assignment",
    severity: "medium",
    pattern: /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[^"'\s]{12,}/gi,
    replacement: "[REDACTED_SECRET_ASSIGNMENT]",
    blockAi: false,
  },
];

export function redactText(input: string): RedactionResult {
  const findings: RedactionFinding[] = [];
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  for (const rule of redactionRules) {
    for (const match of input.matchAll(rule.pattern)) {
      if (match.index === undefined) {
        continue;
      }

      const start = match.index;
      const end = start + match[0].length;

      if (replacements.some((existing) => rangesOverlap(start, end, existing.start, existing.end))) {
        continue;
      }

      replacements.push({ start, end, replacement: rule.replacement });
      findings.push({
        type: rule.type,
        severity: rule.severity,
        label: rule.label,
        start,
        end,
        replacement: rule.replacement,
        requiresReview: rule.severity === "high" || rule.severity === "critical",
      });
    }
  }

  const redactedText = replacements
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, item) => `${text.slice(0, item.start)}${item.replacement}${text.slice(item.end)}`,
      input,
    );
  const blocked = findings.some((finding) => {
    const rule = redactionRules.find((candidate) => candidate.type === finding.type);
    return rule?.blockAi;
  });

  return {
    redactedText,
    findings: findings.sort((a, b) => a.start - b.start),
    blocked,
    requiresReview: findings.some((finding) => finding.requiresReview),
  };
}

export async function redactSourceDocument(
  context: ScopedContext,
  input: string | { sourceDocumentId: string; projectId?: string },
  db: DatabaseClient = prisma,
) {
  const sourceDocumentId = typeof input === "string" ? input : input.sourceDocumentId;
  requireScopedContext(context);
  await assertSourcePermission(context, sourceDocumentId, "source.write", db);

  const source = await db.sourceDocument.findFirstOrThrow({
    where: {
      id: sourceDocumentId,
      orgId: context.orgId,
      deletedAt: null,
    },
  });

  if (typeof input !== "string" && input.projectId && source.projectId !== input.projectId) {
    throw new NotFoundError("Source document not found.");
  }

  const result = redactText(source.rawText ?? "");
  const report = await db.redactionReport.create({
    data: {
      orgId: source.orgId,
      projectId: source.projectId,
      sourceDocumentId: source.id,
      blocked: result.blocked,
      findings: result.findings,
      redactedText: result.redactedText,
    },
  });

  await db.sourceDocument.update({
    where: {
      id: source.id,
      orgId: context.orgId,
    },
    data: {
      status: result.blocked ? "BLOCKED" : "REDACTED",
      metadata: {
        ...(isRecord(source.metadata) ? source.metadata : {}),
        redaction: {
          reportId: report.id,
          blocked: result.blocked,
          findings: result.findings.length,
          requiresReview: result.requiresReview,
        },
      },
    },
  });

  return {
    report,
    result,
  };
}

export async function getRedactedSourceTextForAi(
  context: ScopedContext,
  sourceDocumentId: string,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertSourcePermission(context, sourceDocumentId, "extraction.read", db);

  const report = await db.redactionReport.findFirst({
    where: {
      sourceDocumentId,
      orgId: context.orgId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!report) {
    throw new ValidationServiceError("Source must be redacted before AI processing.");
  }

  if (report.blocked) {
    throw new ValidationServiceError("Source is blocked by redaction review.");
  }

  return report.redactedText ?? "";
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
