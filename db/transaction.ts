import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";

export type DatabaseClient = PrismaClientLike | Prisma.TransactionClient;

type PrismaClientLike = Pick<
  typeof prisma,
  | "$transaction"
  | "artifactExport"
  | "editorRevision"
  | "extractionRun"
  | "job"
  | "project"
  | "redactionReport"
  | "sourceConnection"
  | "sourceDocument"
  | "sourceFile"
  | "storyArtifact"
  | "storyRun"
  | "usageEvent"
  | "membership"
  | "normalizedSource"
  | "normalizedSourceChunk"
  | "auditLog"
  | "organization"
  | "user"
>;

export function runInTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(callback);
}
