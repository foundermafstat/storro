import type { Prisma, SourceDocument, SourceType } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertSourcePermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { formatGitEvidenceSummary, parseGitEvidence } from "@/services/git-evidence-parser";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type ParsedSection = {
  title: string;
  startLine: number;
  endLine?: number;
};

export type SourceParserResult = {
  text: string;
  metadata: Record<string, unknown>;
  warnings: string[];
  sections: ParsedSection[];
  sourceCreatedAt?: Date;
  confidence: number;
};

export type SourceParserInput = {
  sourceType: SourceType;
  title: string;
  rawText?: string | null;
  rawObjectKey?: string | null;
  metadata?: Prisma.JsonValue | null;
};

export type SourceParser = {
  id: string;
  sourceTypes: SourceType[];
  extensions?: string[];
  parse(input: SourceParserInput): Promise<SourceParserResult> | SourceParserResult;
};

const textSourceTypes: SourceType[] = [
  "MANUAL_NOTE",
  "CHATGPT_NOTE",
  "GITHUB_COMMIT",
  "GITHUB_PULL_REQUEST",
  "GITHUB_RELEASE",
  "CODEX_NOTE",
  "CLI_SNAPSHOT",
  "MCP_NOTE",
  "WEBHOOK_EVENT",
];

export class SourceParserRegistry {
  private readonly parsers: SourceParser[] = [];

  register(parser: SourceParser) {
    this.parsers.push(parser);
    return this;
  }

  resolve(input: SourceParserInput) {
    const extension = getSourceExtension(input);

    const parser = this.parsers.find((candidate) => {
      const supportsType = candidate.sourceTypes.includes(input.sourceType);
      const supportsExtension =
        !candidate.extensions ||
        !extension ||
        candidate.extensions.includes(extension);

      return supportsType && supportsExtension;
    });

    if (!parser) {
      throw new ValidationServiceError("Unsupported source parser.", {
        sourceType: input.sourceType,
        extension,
      });
    }

    return parser;
  }
}

export const plainTextParser: SourceParser = {
  id: "plain-text",
  sourceTypes: textSourceTypes,
  parse(input) {
    const text = requireRawText(input);
    const warnings = buildTextWarnings(text);

    return {
      text,
      metadata: {
        parser: "plain-text",
        lineCount: text.split(/\r?\n/).length,
      },
      warnings,
      sections: detectMarkdownSections(text),
      sourceCreatedAt: readSourceCreatedAt(input.metadata),
      confidence: warnings.length > 0 ? 0.72 : 0.92,
    };
  },
};

export const fileTextParser: SourceParser = {
  id: "file-text",
  sourceTypes: ["FILE_UPLOAD"],
  extensions: [".txt", ".md", ".markdown"],
  parse(input) {
    const text = requireRawText(input);
    const warnings = buildTextWarnings(text);

    return {
      text,
      metadata: {
        parser: "file-text",
        extension: getSourceExtension(input),
      },
      warnings,
      sections: detectMarkdownSections(text),
      sourceCreatedAt: readSourceCreatedAt(input.metadata),
      confidence: warnings.length > 0 ? 0.7 : 0.9,
    };
  },
};

export const jsonParser: SourceParser = {
  id: "json",
  sourceTypes: ["CHATGPT_EXPORT", "FILE_UPLOAD"],
  extensions: [".json"],
  parse(input) {
    const text = requireRawText(input);
    const parsed = JSON.parse(text) as unknown;
    const extractedText = extractTextFromJson(parsed);
    const warnings = extractedText.trim() ? [] : ["JSON parsed but no textual fields were detected."];

    return {
      text: extractedText || text,
      metadata: {
        parser: "json",
        rootType: Array.isArray(parsed) ? "array" : typeof parsed,
      },
      warnings,
      sections: [],
      sourceCreatedAt: readSourceCreatedAt(input.metadata),
      confidence: warnings.length > 0 ? 0.55 : 0.84,
    };
  },
};

export const gitEvidenceParser: SourceParser = {
  id: "git-evidence",
  sourceTypes: ["GIT_DIFF", "COMMIT_LOG"],
  parse(input) {
    const text = requireRawText(input);
    const parsed = parseGitEvidence(text);

    return {
      text: formatGitEvidenceSummary(parsed),
      metadata: {
        parser: "git-evidence",
        git: parsed,
      },
      warnings: parsed.warnings,
      sections: [],
      sourceCreatedAt: readSourceCreatedAt(input.metadata),
      confidence: parsed.warnings.length > 0 ? 0.45 : 0.88,
    };
  },
};

export const defaultSourceParserRegistry = new SourceParserRegistry()
  .register(jsonParser)
  .register(gitEvidenceParser)
  .register(fileTextParser)
  .register(plainTextParser);

export async function parseSourceDocumentContent(
  input: SourceParserInput,
  registry: SourceParserRegistry = defaultSourceParserRegistry,
) {
  const parser = registry.resolve(input);

  try {
    return await parser.parse(input);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ValidationServiceError("Source parser failed.", {
        parserId: parser.id,
        reason: error.message,
      });
    }

    throw error;
  }
}

export async function parseAndPersistSourceDocument(
  context: ScopedContext,
  input: string | { sourceDocumentId: string; projectId?: string },
  registry: SourceParserRegistry = defaultSourceParserRegistry,
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

  try {
    const result = await parseSourceDocumentContent(sourceToParserInput(source), registry);
    const normalizedSource = await db.normalizedSource.create({
      data: {
        orgId: source.orgId,
        projectId: source.projectId,
        sourceDocumentId: source.id,
        sourceType: source.sourceType,
        title: source.title,
        body: result.text,
        metadata: {
          ...toInputJsonObject(result.metadata),
          parser: {
            warnings: result.warnings,
            sections: result.sections,
            confidence: result.confidence,
          },
        },
        isPrivate: source.isPrivate,
        sourceCreatedAt: result.sourceCreatedAt ?? source.sourceCreatedAt,
      },
    });

    await db.sourceDocument.update({
      where: {
        id: source.id,
        orgId: context.orgId,
      },
      data: {
        status: "PARSED",
        parsedAt: new Date(),
        metadata: mergeSourceMetadata(source.metadata, {
          parser: {
            status: "parsed",
            warnings: result.warnings,
            sections: result.sections,
            confidence: result.confidence,
            normalizedSourceId: normalizedSource.id,
          },
        }),
      },
    });

    return {
      normalizedSource,
      warnings: result.warnings,
    };
  } catch (error) {
    await db.sourceDocument.update({
      where: {
        id: source.id,
        orgId: context.orgId,
      },
      data: {
        status: "FAILED",
        metadata: mergeSourceMetadata(source.metadata, {
          parser: {
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown parser error.",
          },
        }),
      },
    });

    throw error;
  }
}

function sourceToParserInput(source: SourceDocument): SourceParserInput {
  return {
    sourceType: source.sourceType,
    title: source.title,
    rawText: source.rawText,
    rawObjectKey: source.rawObjectKey,
    metadata: source.metadata,
  };
}

function requireRawText(input: SourceParserInput) {
  if (!input.rawText?.trim()) {
    throw new ValidationServiceError("Source document has no raw text to parse.", {
      sourceType: input.sourceType,
      rawObjectKey: input.rawObjectKey,
    });
  }

  return input.rawText;
}

function buildTextWarnings(text: string) {
  const warnings: string[] = [];

  if (text.length < 20) {
    warnings.push("Source text is very short.");
  }

  if (/secret|api[_-]?key|password/i.test(text)) {
    warnings.push("Potential sensitive token language detected before redaction.");
  }

  return warnings;
}

function detectMarkdownSections(text: string): ParsedSection[] {
  const lines = text.split(/\r?\n/);
  const sections: ParsedSection[] = [];

  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);

    if (!match) {
      return;
    }

    const previous = sections.at(-1);
    if (previous) {
      previous.endLine = index;
    }

    sections.push({
      title: match[2].trim(),
      startLine: index + 1,
    });
  });

  if (sections.length > 0) {
    sections[sections.length - 1].endLine = lines.length;
  }

  return sections;
}

function extractTextFromJson(value: unknown): string {
  const chunks: string[] = [];

  walkJson(value, chunks);

  return chunks.join("\n").trim();
}

function walkJson(value: unknown, chunks: string[]) {
  if (typeof value === "string") {
    if (value.trim().length > 0) {
      chunks.push(value.trim());
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, chunks));
    return;
  }

  if (isRecord(value)) {
    Object.values(value).forEach((item) => walkJson(item, chunks));
  }
}

function getSourceExtension(input: SourceParserInput) {
  const candidate = input.rawObjectKey ?? input.title;
  const match = candidate.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0];
}

function readSourceCreatedAt(metadata: Prisma.JsonValue | null | undefined) {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const value = metadata.sourceCreatedAt;
  return typeof value === "string" ? new Date(value) : undefined;
}

function mergeSourceMetadata(
  existing: Prisma.JsonValue | null,
  patch: Record<string, unknown>,
): Prisma.InputJsonObject {
  return {
    ...toInputJsonObject(existing),
    ...toInputJsonObject(patch),
  };
}

function toInputJsonObject(value: unknown): Prisma.InputJsonObject {
  return isRecord(value) ? (value as Prisma.InputJsonObject) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
