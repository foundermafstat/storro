import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { executeMcpTool } from "@/services/mcp-server-service";
import { createSourceDocument } from "@/services/source-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export const chatGptNoHiddenHistoryDisclaimer =
  "The ChatGPT App sends only user-selected context to Storro. It does not access all ChatGPT history or hidden conversations.";

export async function connectChatGptApp(
  context: ScopedContext,
  input: {
    externalId: string;
    displayName?: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);

  return db.integrationAccount.upsert({
    where: {
      orgId_provider_externalId: {
        orgId: context.orgId,
        provider: "CHATGPT",
        externalId: input.externalId,
      },
    },
    update: {
      status: "CONNECTED",
      displayName: input.displayName,
      metadata: {
        connectedAt: new Date().toISOString(),
        noHiddenHistoryAccess: true,
        disclaimer: chatGptNoHiddenHistoryDisclaimer,
      },
    },
    create: {
      orgId: context.orgId,
      provider: "CHATGPT",
      status: "CONNECTED",
      externalId: input.externalId,
      displayName: input.displayName,
      metadata: {
        connectedAt: new Date().toISOString(),
        noHiddenHistoryAccess: true,
        disclaimer: chatGptNoHiddenHistoryDisclaimer,
      },
    },
  });
}

export async function ingestSelectedChatGptContext(
  context: ScopedContext,
  input: {
    projectId: string;
    title: string;
    selectedText: string;
    sourceUrl?: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);

  return createSourceDocument(
    context,
    {
      projectId: input.projectId,
      title: input.title,
      body: input.selectedText,
      sourceType: "CHATGPT_NOTE",
      tags: ["chatgpt-app", "selected-context"],
      provenance: {
        kind: "chatgpt",
        externalUrl: input.sourceUrl,
        importedAt: new Date(),
      },
      metadata: {
        chatGptApp: {
          selectedOnly: true,
          noHiddenHistoryAccess: true,
          disclaimer: chatGptNoHiddenHistoryDisclaimer,
        },
      },
    },
    db,
  );
}

export async function generateStoryFromChatGptApp(
  context: ScopedContext,
  input: {
    projectId: string;
    storyRunId: string;
  },
  db: DatabaseClient = prisma,
) {
  return executeMcpTool(context, {
    name: "generate_story",
    arguments: input,
  }, db);
}

export async function listChatGptArtifacts(
  context: ScopedContext,
  input: {
    projectId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.read", db);

  return db.storyArtifact.findMany({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
      archivedAt: null,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function retrieveChatGptArtifact(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
  },
  db: DatabaseClient = prisma,
) {
  return executeMcpTool(context, {
    name: "retrieve_artifact",
    arguments: input,
  }, db);
}

export async function saveChatGptDraft(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
    contentMarkdown: string;
  },
  db: DatabaseClient = prisma,
) {
  return executeMcpTool(context, {
    name: "save_revision",
    arguments: input,
  }, db);
}

export function chatGptAppManifest(baseUrl: string): Prisma.InputJsonObject {
  return {
    name: "Storro",
    description: "Send selected ChatGPT context into Storro projects and retrieve generated artifacts.",
    mcpServer: `${baseUrl.replace(/\/$/, "")}/api/mcp`,
    oauth: {
      authorizationUrl: `${baseUrl.replace(/\/$/, "")}/api/auth/signin`,
    },
    privacy: {
      selectedContextOnly: true,
      disclaimer: chatGptNoHiddenHistoryDisclaimer,
    },
  };
}
