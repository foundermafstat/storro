import { z } from "zod";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import {
  callAiGateway,
  type AiGatewayProvider,
  type AiModelPolicy,
} from "@/services/ai-gateway";
import { assertOrgPermission, assertProjectPermission } from "@/services/authorization-service";
import { AiFailureError, NotFoundError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

const extractionFactSchema = z.object({
  category: z.string().min(1),
  text: z.string().min(1),
  sourceChunkIndexes: z.array(z.number().int().nonnegative()).default([]),
  filePaths: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  isPrivate: z.boolean().default(false),
  reasoningNote: z.string().optional(),
});

const extractionOutputSchema = z.object({
  facts: z.array(extractionFactSchema).default([]),
  missingContext: z.array(z.string()).default([]),
  riskFlags: z
    .array(
      z.object({
        type: z.string(),
        severity: z.enum(["low", "medium", "high", "critical"]),
        message: z.string(),
      }),
    )
    .default([]),
});

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

export type CreateExtractionRunInput = {
  projectId: string;
  selectedSourceIds: string[];
  model?: string;
  promptVersion?: string;
};

export async function createExtractionRun(
  context: ScopedContext,
  input: CreateExtractionRunInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "extraction.write", db);

  if (input.selectedSourceIds.length === 0) {
    throw new ValidationServiceError("Select at least one source for extraction.");
  }

  return db.extractionRun.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      createdById: context.userId,
      status: "QUEUED",
      selectedSourceIds: input.selectedSourceIds,
      model: input.model,
      promptVersion: input.promptVersion ?? "extraction.v1",
    },
  });
}

export async function executeExtractionRun(
  context: ScopedContext,
  input: {
    extractionRunId: string;
    projectId?: string;
    chunkIds?: string[];
  },
  provider: AiGatewayProvider,
  modelPolicy: AiModelPolicy,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "extraction.write", db);

  const run = await db.extractionRun.findFirst({
    where: {
      id: input.extractionRunId,
      orgId: context.orgId,
    },
  });

  if (!run) {
    throw new NotFoundError("Extraction run not found.");
  }

  if (input.projectId && run.projectId !== input.projectId) {
    throw new NotFoundError("Extraction run not found.");
  }

  await db.extractionRun.update({
    where: {
      id: run.id,
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  try {
    const chunks = await loadExtractionChunks(context, run.projectId, run.selectedSourceIds, input.chunkIds, db);
    const missingContext: string[] = [];
    const riskFlags: Array<{ type: string; severity: string; message: string }> = [];
    const facts = [];

    for (const chunk of chunks) {
      const output = await extractFactsFromChunk(context, run, chunk, provider, modelPolicy, db);
      missingContext.push(...output.missingContext);
      riskFlags.push(...output.riskFlags);

      for (const fact of output.facts) {
        facts.push(
          await db.extractionFact.create({
            data: {
              orgId: run.orgId,
              projectId: run.projectId,
              extractionRunId: run.id,
              category: fact.category,
              text: fact.text,
              sourceIds: [chunk.normalizedSource.sourceDocumentId],
              filePaths: fact.filePaths,
              confidence: fact.confidence,
              isPrivate: fact.isPrivate || chunk.normalizedSource.isPrivate,
              reviewStatus: "PENDING",
              reasoningNote: fact.reasoningNote,
            },
          }),
        );
      }
    }

    const completed = await db.extractionRun.update({
      where: {
        id: run.id,
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        missingContext,
        riskFlags,
      },
    });

    return {
      run: completed,
      facts,
      missingContext,
      riskFlags,
    };
  } catch (error) {
    await db.extractionRun.update({
      where: {
        id: run.id,
      },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Extraction failed.",
        riskFlags: {
          failedChunks: input.chunkIds ?? "selected_sources",
        },
      },
    });

    throw error;
  }
}

async function extractFactsFromChunk(
  context: ScopedContext,
  run: {
    id: string;
    projectId: string;
    promptVersion: string | null;
  },
  chunk: Awaited<ReturnType<typeof loadExtractionChunks>>[number],
  provider: AiGatewayProvider,
  modelPolicy: AiModelPolicy,
  db: DatabaseClient,
) {
  const gatewayResult = await callAiGateway(
    context,
    {
      task: "extraction",
      projectId: run.projectId,
      promptVersion: run.promptVersion ?? "extraction.v1",
      messages: [
        {
          role: "system",
          content:
            "Extract traceable build facts from the provided redacted source chunk. Return only facts grounded in the chunk.",
        },
        {
          role: "user",
          content: chunk.body,
        },
      ],
      jsonSchema: {
        name: "storro_extraction",
        schema: extractionJsonSchema,
      },
      maxRetries: 1,
      backoffMs: 0,
    },
    provider,
    modelPolicy,
    db,
  );
  const parsed = extractionOutputSchema.safeParse(gatewayResult.parsed);

  if (!parsed.success) {
    throw new AiFailureError("Structured extraction output validation failed.", {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

async function loadExtractionChunks(
  context: ScopedContext,
  projectId: string,
  selectedSourceIds: string[],
  chunkIds: string[] | undefined,
  db: DatabaseClient,
) {
  const chunks = await db.normalizedSourceChunk.findMany({
    where: {
      orgId: context.orgId,
      projectId,
      id: chunkIds ? { in: chunkIds } : undefined,
      normalizedSource: {
        sourceDocumentId: {
          in: selectedSourceIds,
        },
      },
    },
    include: {
      normalizedSource: {
        select: {
          sourceDocumentId: true,
          isPrivate: true,
        },
      },
    },
    orderBy: {
      chunkIndex: "asc",
    },
  });

  if (chunks.length === 0) {
    throw new ValidationServiceError("No normalized chunks found for extraction.");
  }

  return chunks;
}

export const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string" },
          text: { type: "string" },
          sourceChunkIndexes: { type: "array", items: { type: "integer" } },
          filePaths: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          isPrivate: { type: "boolean" },
          reasoningNote: { type: "string" },
        },
        required: ["category", "text", "sourceChunkIndexes", "filePaths", "confidence", "isPrivate"],
      },
    },
    missingContext: {
      type: "array",
      items: { type: "string" },
    },
    riskFlags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          message: { type: "string" },
        },
        required: ["type", "severity", "message"],
      },
    },
  },
  required: ["facts", "missingContext", "riskFlags"],
};
