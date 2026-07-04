import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { createSourceDocument } from "@/services/source-service";
import type { ScopedContext } from "@/services/scoped-context";

export type ManualNoteKind =
  | "research_note"
  | "build_note"
  | "daily_journal"
  | "failed_attempt"
  | "lesson"
  | "public_comment"
  | "private_comment";

export type StructuredManualNoteInput = {
  projectId: string;
  title: string;
  kind: ManualNoteKind;
  whatTried?: string;
  whatWorked?: string;
  whatFailed?: string;
  filesTouched?: string[];
  nextStep?: string;
  publicSummary?: string;
  privateNotes?: string;
  isPrivate?: boolean;
  tags?: string[];
  sourceCreatedAt?: Date;
};

export async function createStructuredManualNote(
  context: ScopedContext,
  input: StructuredManualNoteInput,
  db: DatabaseClient = prisma,
) {
  const body = formatManualNoteBody(input);
  const tags = ["manual", input.kind, ...(input.tags ?? [])];

  return createSourceDocument(
    context,
    {
      projectId: input.projectId,
      title: input.title,
      body,
      sourceType: "MANUAL_NOTE",
      tags,
      isPrivate: input.isPrivate ?? true,
      sourceCreatedAt: input.sourceCreatedAt,
      metadata: {
        manualNote: {
          kind: input.kind,
          whatTried: input.whatTried,
          whatWorked: input.whatWorked,
          whatFailed: input.whatFailed,
          filesTouched: input.filesTouched ?? [],
          nextStep: input.nextStep,
          publicSummary: input.publicSummary,
          hasPrivateNotes: Boolean(input.privateNotes),
          rankingBoost: 50,
        },
      },
      provenance: {
        kind: "manual_input",
        importedAt: new Date(),
      },
    },
    db,
  );
}

function formatManualNoteBody(input: StructuredManualNoteInput) {
  return [
    `# ${input.title}`,
    `Kind: ${input.kind}`,
    formatSection("Public summary", input.publicSummary),
    formatSection("What was tried", input.whatTried),
    formatSection("What worked", input.whatWorked),
    formatSection("What failed", input.whatFailed),
    formatSection("Files touched", input.filesTouched?.join("\n")),
    formatSection("Next step", input.nextStep),
    formatSection("Private notes", input.privateNotes),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatSection(title: string, value?: string) {
  if (!value?.trim()) {
    return "";
  }

  return `## ${title}\n${value.trim()}`;
}
