import { readFileSync } from "fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  chatGptAppManifest,
  chatGptNoHiddenHistoryDisclaimer,
  connectChatGptApp,
  ingestSelectedChatGptContext,
  listChatGptArtifacts,
  retrieveChatGptArtifact,
  saveChatGptDraft,
} from "@/services/chatgpt-app-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let artifactId = "";
let context: ScopedContext;

describe("chatgpt app service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `chatgpt-app-user-${suffix}`,
        email: `chatgpt-app-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `ChatGPT App Org ${suffix}`,
        slug: `chatgpt-app-org-${suffix}`,
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
      name: `ChatGPT App Project ${suffix}`,
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
    const storyRun = await prisma.storyRun.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: extractionRun.id,
        createdById: userId,
        status: "COMPLETED",
        templateId: "github-release-notes",
        format: "GITHUB_RELEASE_NOTES",
      },
    });
    const artifact = await prisma.storyArtifact.create({
      data: {
        orgId,
        projectId: project.id,
        storyRunId: storyRun.id,
        format: "GITHUB_RELEASE_NOTES",
        title: "ChatGPT artifact",
        contentMarkdown: "## Draft",
      },
    });

    projectId = project.id;
    artifactId = artifact.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("connects a ChatGPT App user and publishes a manifest", async () => {
    const integration = await connectChatGptApp(context, {
      externalId: `chatgpt-${suffix}`,
      displayName: "ChatGPT",
    });
    const manifest = chatGptAppManifest("https://storro.local");

    expect(integration).toMatchObject({
      provider: "CHATGPT",
      status: "CONNECTED",
    });
    expect(manifest.privacy).toMatchObject({
      selectedContextOnly: true,
    });
  });

  it("creates sources only from user-selected context", async () => {
    const source = await ingestSelectedChatGptContext(context, {
      projectId,
      title: "Selected note",
      selectedText: "Only this selected note is sent.",
    });

    expect(source.sourceType).toBe("CHATGPT_NOTE");
    expect(source.metadata).toMatchObject({
      chatGptApp: {
        selectedOnly: true,
        noHiddenHistoryAccess: true,
      },
    });
  });

  it("retrieves artifacts and saves drafts through Storro workflows", async () => {
    const artifacts = await listChatGptArtifacts(context, { projectId });
    const retrieved = await retrieveChatGptArtifact(context, { projectId, artifactId });
    const saved = await saveChatGptDraft(context, {
      projectId,
      artifactId,
      contentMarkdown: "## Draft saved from ChatGPT",
    });

    expect(artifacts.map((artifact) => artifact.id)).toContain(artifactId);
    expect(retrieved).toMatchObject({ artifact: { id: artifactId } });
    expect(saved).toMatchObject({ revision: { revision: { contentMarkdown: "## Draft saved from ChatGPT" } } });
  });

  it("documents no hidden conversation access", () => {
    const docs = readFileSync("docs/integrations/chatgpt-app.md", "utf8");

    expect(chatGptNoHiddenHistoryDisclaimer).toContain("user-selected context");
    expect(docs).toContain("does not access all ChatGPT history");
    expect(docs.toLowerCase()).not.toContain("hidden conversation access is available");
  });
});
