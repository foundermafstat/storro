# Storro — Technical Architecture

**Product:** Storro — Personal Developer Story Engine  
**Document type:** Technical architecture  
**Target:** MVP with production-ready integration direction  
**Stack:** Next.js, TypeScript, Tailwind, shadcn/ui, PostgreSQL, Prisma, OpenAI, GitHub API  

---

## 1. Architecture Goals

Storro must be built as a reliable developer-memory system, not as a thin prompt wrapper.

The architecture must support:

1. Multiple source types.
2. Safe source ingestion.
3. Secret redaction before AI calls.
4. Structured extraction with traceability.
5. Multi-format story generation.
6. Markdown editing and export.
7. Future official integrations with ChatGPT, Codex, and GitHub.

The MVP should remain simple enough to build quickly, but the codebase should not block future integrations.

---

## 2. High-Level System Design

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Storro Web App                           │
│                 Next.js App Router + shadcn/ui                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API / Server Layer                         │
│      Route Handlers + Services + Auth + Validation + Jobs        │
└──────────────┬────────────────┬────────────────┬────────────────┘
               │                │                │
               ▼                ▼                ▼
┌───────────────────┐ ┌───────────────────┐ ┌────────────────────┐
│ Ingestion Engine  │ │ AI Story Engine    │ │ Integration Layer  │
│ source parsing,   │ │ extraction, story  │ │ GitHub, ChatGPT,   │
│ normalization,    │ │ planning, content  │ │ Codex future MCP   │
│ redaction         │ │ generation         │ │                    │
└─────────┬─────────┘ └─────────┬─────────┘ └──────────┬─────────┘
          │                     │                      │
          ▼                     ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL + Prisma                          │
│   users, projects, sources, extractions, story runs, artifacts  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Technical Principles

### 3.1 Source-Grounded Generation

Generated writing must be based on stored source documents and reviewed extraction facts.

Do not generate directly from raw diffs into final article in one step. The required pipeline is:

```text
source → normalized source → redacted source → extracted facts → story plan → artifact
```

### 3.2 Explicit Integrations Only

No private UI scraping.

- ChatGPT context enters through paste, upload/export, or future official ChatGPT App/MCP tool.
- Codex context enters through git, GitHub, Codex Action artifacts, optional notes, or future plugin/MCP path.
- GitHub context enters through GitHub API/webhooks with explicit user authorization.

### 3.3 Safety Before AI

All raw text must pass through redaction and file filters before AI processing.

### 3.4 Traceability

Important extracted claims should keep source references.

Example:

```json
{
  "category": "implementation_change",
  "text": "Added GitHub source import for commits and pull requests.",
  "sourceIds": ["src_123", "src_124"],
  "filePaths": ["src/lib/github/client.ts", "src/app/api/projects/[id]/github/import/route.ts"],
  "confidence": 0.91
}
```

---

## 4. Deployment Topology

### 4.1 MVP Local / Hackathon Deployment

```text
Vercel / local Next.js app
        │
        ▼
PostgreSQL database
        │
        ▼
OpenAI API
        │
        ▼
GitHub API
```

For a fast MVP, route handlers can perform jobs synchronously for small inputs. For larger diffs, create a database job and poll status.

### 4.2 Production Topology

```text
Next.js Web App
        │
        ▼
API Gateway / Next.js Route Handlers
        │
        ├── PostgreSQL
        ├── Redis / Queue
        ├── Worker Process
        ├── Object Storage
        ├── OpenAI API
        ├── GitHub App API
        └── MCP Server for ChatGPT/Codex future integration
```

Production should separate long-running AI tasks into workers.

---

## 5. Module Breakdown

### 5.1 Frontend Modules

```text
components/
  app-shell/
    sidebar.tsx
    topbar.tsx
    project-switcher.tsx
  project/
    project-card.tsx
    project-form.tsx
    project-header.tsx
  source-input/
    source-tabs.tsx
    paste-note-form.tsx
    file-upload-zone.tsx
    git-diff-input.tsx
    github-import-panel.tsx
    source-preview.tsx
  extraction/
    extraction-board.tsx
    extraction-section.tsx
    extraction-fact-card.tsx
    notable-files-list.tsx
    timeline-view.tsx
  story-output/
    template-selector.tsx
    generation-settings.tsx
    story-run-status.tsx
    artifact-card.tsx
  editor/
    markdown-editor.tsx
    markdown-preview.tsx
    revision-list.tsx
    export-actions.tsx
```

### 5.2 Backend Service Modules

```text
server/services/
  project-service.ts
  source-service.ts
  ingestion-service.ts
  extraction-service.ts
  story-service.ts
  artifact-service.ts
  github-service.ts
  integration-service.ts
  redaction-service.ts
```

### 5.3 Library Modules

```text
lib/
  ai/
    openai.ts
    schemas.ts
    prompts.ts
    extraction.ts
    story-planning.ts
    generation.ts
    grounding.ts
    token-budget.ts
  chatgpt/
    export-parser.ts
    conversation-selector.ts
    note-normalizer.ts
  codex/
    codex-note-parser.ts
    local-git-summary.ts
    action-artifact-parser.ts
  github/
    client.ts
    app-auth.ts
    rest.ts
    graphql.ts
    webhook.ts
    diff-normalizer.ts
  markdown/
    templates.ts
    frontmatter.ts
    exporter.ts
  security/
    secret-patterns.ts
    redactor.ts
    file-filters.ts
  jobs/
    job-runner.ts
    job-status.ts
  prisma.ts
  auth.ts
```

---

## 6. Data Model

### 6.1 Entity Relationship Overview

```text
User
 └── Project
      ├── SourceConnection
      ├── SourceDocument
      ├── GitRepository
      │    ├── GitCommit
      │    └── PullRequest
      ├── Extraction
      │    └── ExtractionFact
      ├── StoryRun
      │    └── StoryArtifact
      │          └── EditorRevision
      └── IngestionRun
```

---

## 7. Prisma Schema Draft

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ProjectType {
  HACKATHON
  PRODUCT_MVP
  OPEN_SOURCE
  CLIENT_PROJECT
  LEARNING
  OTHER
}

enum SourceType {
  CHATGPT_NOTE
  CHATGPT_EXPORT
  MANUAL_NOTE
  GIT_DIFF
  COMMIT_LOG
  GITHUB_REPOSITORY
  GITHUB_COMMIT
  GITHUB_PULL_REQUEST
  CODEX_NOTE
  CODEX_ACTION_ARTIFACT
}

enum SourceStatus {
  UPLOADED
  PARSED
  REDACTED
  EXTRACTED
  FAILED
}

enum StoryTemplate {
  LONG_ARTICLE
  DORAHACKS_UPDATE
  TWITTER_THREAD
  LINKEDIN_POST
  GITHUB_RELEASE_NOTES
  PRIVATE_JOURNAL
}

enum StoryStatus {
  QUEUED
  RUNNING
  READY
  FAILED
}

enum ArtifactStatus {
  DRAFT
  EDITED
  EXPORTED
}

model User {
  id        String    @id @default(cuid())
  email     String?   @unique
  name      String?
  image     String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  projects Project[]
}

model Project {
  id             String      @id @default(cuid())
  userId         String
  name           String
  slug           String
  description    String?
  projectType    ProjectType @default(PRODUCT_MVP)
  repositoryUrl  String?
  defaultTone    String?     @default("technical_build_in_public")
  defaultAudience String?    @default("developers")
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  user            User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  sources         SourceDocument[]
  connections     SourceConnection[]
  repositories    GitRepository[]
  ingestionRuns   IngestionRun[]
  extractions     Extraction[]
  storyRuns       StoryRun[]
  artifacts       StoryArtifact[]

  @@unique([userId, slug])
  @@index([userId])
}

model SourceConnection {
  id             String     @id @default(cuid())
  projectId      String
  provider       String
  externalId     String?
  displayName    String?
  accessType     String?
  encryptedToken String?
  metadata       Json?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  project        Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}

model SourceDocument {
  id             String       @id @default(cuid())
  projectId      String
  sourceType     SourceType
  status         SourceStatus @default(UPLOADED)
  title          String
  rawText        String
  redactedText   String?
  summary        String?
  metadata       Json?
  isPrivate      Boolean      @default(false)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  project        Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  extractionFacts ExtractionFact[]

  @@index([projectId])
  @@index([sourceType])
}

model GitRepository {
  id             String   @id @default(cuid())
  projectId      String
  provider       String   @default("github")
  owner          String
  name           String
  defaultBranch  String?
  htmlUrl        String?
  private        Boolean  @default(false)
  lastSyncedAt   DateTime?
  metadata       Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  commits        GitCommit[]
  pullRequests   PullRequest[]

  @@unique([projectId, owner, name])
  @@index([projectId])
}

model GitCommit {
  id             String   @id @default(cuid())
  repositoryId   String
  sha            String
  message        String
  authorName     String?
  authorEmail    String?
  committedAt    DateTime?
  url            String?
  changedFiles   Int?
  additions      Int?
  deletions      Int?
  fileSummary    Json?
  patchText      String?
  metadata       Json?
  createdAt      DateTime @default(now())

  repository     GitRepository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  @@unique([repositoryId, sha])
  @@index([repositoryId])
}

model PullRequest {
  id             String   @id @default(cuid())
  repositoryId   String
  number         Int
  title          String
  body           String?
  state          String
  authorLogin    String?
  headRef        String?
  baseRef        String?
  mergedAt       DateTime?
  url            String?
  metadata       Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  repository     GitRepository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  @@unique([repositoryId, number])
  @@index([repositoryId])
}

model IngestionRun {
  id             String   @id @default(cuid())
  projectId      String
  sourceType     SourceType
  status         String   @default("queued")
  startedAt      DateTime?
  finishedAt     DateTime?
  error          String?
  metadata       Json?
  createdAt      DateTime @default(now())

  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}

model Extraction {
  id             String   @id @default(cuid())
  projectId      String
  title          String?
  status         String   @default("ready")
  model          String?
  sourceIds      String[]
  rawJson        Json
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  facts          ExtractionFact[]
  storyRuns      StoryRun[]

  @@index([projectId])
}

model ExtractionFact {
  id             String   @id @default(cuid())
  extractionId   String
  sourceDocumentId String?
  category       String
  text           String
  confidence     Float?
  sourceIds      String[]
  filePaths      String[]
  isImportant    Boolean  @default(false)
  isPrivate      Boolean  @default(false)
  userEdited     Boolean  @default(false)
  metadata       Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  extraction     Extraction     @relation(fields: [extractionId], references: [id], onDelete: Cascade)
  sourceDocument SourceDocument? @relation(fields: [sourceDocumentId], references: [id], onDelete: SetNull)

  @@index([extractionId])
  @@index([category])
}

model StoryRun {
  id             String        @id @default(cuid())
  projectId      String
  extractionId   String?
  template       StoryTemplate
  status         StoryStatus   @default(QUEUED)
  tone           String?
  audience       String?
  settings       Json?
  model          String?
  error          String?
  startedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime      @default(now())

  project        Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  extraction     Extraction?   @relation(fields: [extractionId], references: [id], onDelete: SetNull)
  artifacts      StoryArtifact[]

  @@index([projectId])
  @@index([template])
}

model StoryArtifact {
  id             String         @id @default(cuid())
  projectId      String
  storyRunId     String?
  template       StoryTemplate
  status         ArtifactStatus @default(DRAFT)
  title          String
  markdown       String
  plainText      String?
  metadata       Json?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  project        Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  storyRun       StoryRun?      @relation(fields: [storyRunId], references: [id], onDelete: SetNull)
  revisions      EditorRevision[]

  @@index([projectId])
  @@index([template])
}

model EditorRevision {
  id             String   @id @default(cuid())
  artifactId     String
  markdown       String
  createdAt      DateTime @default(now())

  artifact       StoryArtifact @relation(fields: [artifactId], references: [id], onDelete: Cascade)

  @@index([artifactId])
}
```

---

## 8. API Architecture

All API routes should validate input with Zod and call service functions. UI components should not access Prisma directly.

### 8.1 Project Routes

```http
POST /api/projects
GET /api/projects
GET /api/projects/:projectId
PATCH /api/projects/:projectId
DELETE /api/projects/:projectId
```

Example request:

```json
{
  "name": "Storro",
  "description": "Personal Developer Story Engine",
  "projectType": "PRODUCT_MVP",
  "repositoryUrl": "https://github.com/user/storro"
}
```

### 8.2 Source Routes

```http
POST /api/projects/:projectId/sources/paste
POST /api/projects/:projectId/sources/upload
GET /api/projects/:projectId/sources
GET /api/sources/:sourceId
PATCH /api/sources/:sourceId
DELETE /api/sources/:sourceId
```

### 8.3 GitHub Routes

```http
POST /api/projects/:projectId/github/import-repository
POST /api/projects/:projectId/github/import-commits
POST /api/projects/:projectId/github/import-pull-request
POST /api/webhooks/github
```

### 8.4 Extraction Routes

```http
POST /api/projects/:projectId/extractions
GET /api/extractions/:extractionId
PATCH /api/extractions/:extractionId/facts/:factId
DELETE /api/extractions/:extractionId/facts/:factId
```

### 8.5 Story Routes

```http
POST /api/projects/:projectId/story-runs
GET /api/story-runs/:storyRunId
POST /api/story-runs/:storyRunId/regenerate
```

### 8.6 Artifact Routes

```http
GET /api/artifacts/:artifactId
PATCH /api/artifacts/:artifactId
POST /api/artifacts/:artifactId/export
```

---

## 9. Source Normalization

### 9.1 Normalized Source Type

```ts
export type NormalizedSource = {
  id?: string;
  projectId: string;
  sourceType:
    | "CHATGPT_NOTE"
    | "CHATGPT_EXPORT"
    | "MANUAL_NOTE"
    | "GIT_DIFF"
    | "COMMIT_LOG"
    | "GITHUB_REPOSITORY"
    | "GITHUB_COMMIT"
    | "GITHUB_PULL_REQUEST"
    | "CODEX_NOTE"
    | "CODEX_ACTION_ARTIFACT";
  title: string;
  rawText: string;
  metadata: Record<string, unknown>;
  isPrivate?: boolean;
};
```

### 9.2 ChatGPT Note Normalizer

Input:

- pasted text;
- markdown;
- plain text;
- extracted conversation JSON.

Output:

- `SourceDocument` records.

Parser requirements:

- preserve message order;
- remove UI artifacts;
- separate user and assistant messages if available;
- detect titles and timestamps if present;
- allow user to select relevant sections.

### 9.3 Git Diff Normalizer

Input examples:

```text
diff --git a/src/app/page.tsx b/src/app/page.tsx
index 123..456 100644
--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -1,5 +1,10 @@
```

Output:

```ts
export type DiffFileSummary = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  additions?: number;
  deletions?: number;
  patchPreview?: string;
  language?: string;
  shouldSummarize: boolean;
  ignoreReason?: string;
};
```

File filters:

- ignore `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` by default;
- collapse generated files;
- ignore large minified files;
- include config files when relevant;
- include Prisma migrations but summarize compactly;
- include tests as implementation evidence.

### 9.4 GitHub Pull Request Normalizer

Pull request source text should include:

- PR title;
- PR body;
- author;
- state;
- base/head branch;
- merged status;
- linked commits;
- changed files summary;
- review comments in future.

---

## 10. ChatGPT Integration Architecture

### 10.1 MVP: Manual Paste and Export Import

The MVP should support:

1. Paste selected ChatGPT research notes.
2. Upload `conversations.json` from exported data.
3. Select relevant conversations/messages.
4. Store selected messages as source documents.

### 10.2 Parser Shape for ChatGPT Export

The exact export format can vary. Parser should be defensive:

```ts
export type ParsedChatGPTMessage = {
  id?: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
  createdAt?: string;
};

export type ParsedChatGPTConversation = {
  id?: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  messages: ParsedChatGPTMessage[];
};
```

### 10.3 Future: ChatGPT App / MCP Connector

Storro can later expose an MCP server for ChatGPT Apps.

Candidate tools:

```ts
const tools = [
  "storro_create_project",
  "storro_list_projects",
  "storro_ingest_research_note",
  "storro_ingest_build_note",
  "storro_generate_story",
  "storro_get_artifact",
  "storro_save_story_revision"
];
```

Important limitations:

- The app should not assume hidden access to all ChatGPT conversation history.
- The user must explicitly provide or send context to Storro.
- Authentication should use OAuth when user-specific data is exposed.

---

## 11. Codex Integration Architecture

### 11.1 MVP: Git as Codex Evidence

Codex work is reflected in:

- changed files;
- commit messages;
- PR descriptions;
- test results;
- branch history.

Storro should interpret Codex-assisted work through repository evidence.

MVP source types:

- `CODEX_NOTE`: user-pasted Codex session summary.
- `GIT_DIFF`: local diff from Codex changes.
- `GITHUB_PULL_REQUEST`: PR created after Codex work.
- `GITHUB_COMMIT`: commit generated or edited after Codex work.

### 11.2 Local Snapshot CLI — Future Extension

A future CLI can capture local workflow without needing private UI access.

Command idea:

```bash
storro snapshot --project storro --note "Implemented source ingestion and extraction UI"
```

It would collect:

```bash
git status --short
git diff --stat
git diff --cached --stat
git log --oneline -n 10
```

Then send to Storro API.

### 11.3 Codex GitHub Action — Future Extension

A GitHub Action can run on PR and send an artifact to Storro:

```yaml
name: Storro PR Context

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  storro:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@v4
      - name: Generate PR diff context
        run: |
          git fetch origin ${{ github.base_ref }}
          git diff --stat origin/${{ github.base_ref }}...HEAD > storro-diff-stat.txt
          git diff origin/${{ github.base_ref }}...HEAD > storro-diff.patch
      - name: Upload context to Storro
        run: |
          curl -X POST "$STORRO_API_URL/api/integrations/github-action/pr-context" \
            -H "Authorization: Bearer $STORRO_INGEST_TOKEN" \
            -F "projectId=$STORRO_PROJECT_ID" \
            -F "diff=@storro-diff.patch" \
            -F "stat=@storro-diff-stat.txt"
```

### 11.4 Codex Plugin / MCP — Future Extension

A Codex plugin can expose reusable workflows:

- save current work summary to Storro;
- generate release notes for current branch;
- create a Storro build journal from current worktree;
- fetch previous project memory from Storro.

---

## 12. GitHub Integration Architecture

### 12.1 MVP Authentication Options

For fastest development:

1. Local fine-grained token in `.env`.
2. Repository owner/name input.
3. Read-only API calls.

For production:

1. GitHub App.
2. User installs app on selected repositories.
3. Storro stores installation ID and uses short-lived installation tokens.
4. Webhooks keep context updated.

### 12.2 Permissions

Minimum read-only GitHub App permissions:

- Repository metadata: read.
- Contents: read.
- Pull requests: read.
- Issues: read, optional.
- Actions: read, optional.

Optional write permissions should be separate:

- Pull requests: write, only for posting generated PR comments.
- Contents: write, only for creating release note files.
- Releases: write, only for publishing release drafts.

### 12.3 Import Recent Commits

Implementation with Octokit:

```ts
import { Octokit } from "@octokit/rest";

export async function listRecentCommits(params: {
  token: string;
  owner: string;
  repo: string;
  sha?: string;
  since?: string;
  until?: string;
}) {
  const octokit = new Octokit({ auth: params.token });

  const { data } = await octokit.repos.listCommits({
    owner: params.owner,
    repo: params.repo,
    sha: params.sha,
    since: params.since,
    until: params.until,
    per_page: 50,
  });

  return data.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message,
    authorName: commit.commit.author?.name,
    authorEmail: commit.commit.author?.email,
    committedAt: commit.commit.author?.date,
    url: commit.html_url,
  }));
}
```

### 12.4 Import Commit Details

```ts
export async function getCommitDetails(params: {
  token: string;
  owner: string;
  repo: string;
  ref: string;
}) {
  const octokit = new Octokit({ auth: params.token });

  const { data } = await octokit.repos.getCommit({
    owner: params.owner,
    repo: params.repo,
    ref: params.ref,
  });

  return {
    sha: data.sha,
    message: data.commit.message,
    files: data.files?.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    })),
  };
}
```

### 12.5 Import Pull Request

```ts
export async function getPullRequestContext(params: {
  token: string;
  owner: string;
  repo: string;
  pullNumber: number;
}) {
  const octokit = new Octokit({ auth: params.token });

  const [{ data: pr }, { data: files }, { data: commits }] = await Promise.all([
    octokit.pulls.get({ owner: params.owner, repo: params.repo, pull_number: params.pullNumber }),
    octokit.pulls.listFiles({ owner: params.owner, repo: params.repo, pull_number: params.pullNumber, per_page: 100 }),
    octokit.pulls.listCommits({ owner: params.owner, repo: params.repo, pull_number: params.pullNumber, per_page: 100 }),
  ]);

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    mergedAt: pr.merged_at,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    url: pr.html_url,
    files: files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    })),
    commits: commits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
    })),
  };
}
```

### 12.6 Webhook Validation

Webhook route must verify signature before processing.

```ts
import crypto from "crypto";

export function verifyGitHubSignature(params: {
  payload: string;
  signature256: string | null;
  secret: string;
}) {
  if (!params.signature256) return false;

  const hmac = crypto.createHmac("sha256", params.secret);
  const digest = `sha256=${hmac.update(params.payload).digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(params.signature256)
  );
}
```

Webhook events to support later:

- `push`;
- `pull_request`;
- `release`;
- `issues`, optional;
- `workflow_run`, optional.

---

## 13. AI Architecture

### 13.1 OpenAI Client

```ts
import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

### 13.2 Structured Extraction Schema

Use Zod for validation in application code and JSON Schema for model output.

```ts
import { z } from "zod";

export const extractionFactSchema = z.object({
  category: z.enum([
    "goal",
    "problem",
    "research_insight",
    "product_decision",
    "technical_decision",
    "implementation_change",
    "bug_or_blocker",
    "fix",
    "lesson",
    "next_step",
    "notable_file",
    "story_hook",
  ]),
  text: z.string().min(1),
  sourceIds: z.array(z.string()),
  filePaths: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  isPrivate: z.boolean().default(false),
  reasoningNote: z.string().optional(),
});

export const buildExtractionSchema = z.object({
  projectSummary: z.string(),
  facts: z.array(extractionFactSchema),
  timeline: z.array(z.object({
    event: z.string(),
    sourceIds: z.array(z.string()),
    timestamp: z.string().optional(),
  })),
  missingContext: z.array(z.string()),
  riskFlags: z.array(z.string()),
});

export type BuildExtraction = z.infer<typeof buildExtractionSchema>;
```

### 13.3 Extraction Prompt

```text
You are Storro's extraction engine.

Your task is to convert developer source material into structured build facts.

Rules:
- Return only valid JSON matching the provided schema.
- Do not write an article.
- Do not invent facts.
- If something is unclear, add it to missingContext.
- Keep sourceIds for every fact.
- Separate planned work from implemented work.
- Separate product decisions from technical decisions.
- Mark sensitive/private facts as isPrivate when they should not appear in public posts.
- Prefer concrete details: files, modules, APIs, bugs, decisions, tradeoffs.
```

### 13.4 Story Plan Schema

```ts
export const storyPlanSchema = z.object({
  titleOptions: z.array(z.string()),
  hook: z.string(),
  audience: z.string(),
  thesis: z.string(),
  sections: z.array(z.object({
    heading: z.string(),
    purpose: z.string(),
    factsToUse: z.array(z.string()),
  })),
  claimsToAvoid: z.array(z.string()),
  nextStep: z.string(),
});
```

### 13.5 Generation Prompt

```text
You are Storro's developer storytelling writer.

Use only the approved extraction facts and story plan.
Write a polished markdown artifact for the selected template.

Rules:
- Do not invent metrics, users, partnerships, testnet transactions, or completion status.
- Do not use generic AI marketing phrases.
- Include concrete implementation details when available.
- Preserve uncertainty if the source material is unclear.
- The output must be useful to a developer, hackathon judge, or product audience.
- Return markdown only.
```

### 13.6 Grounding Pass

After generation, run a lightweight validation pass:

Input:

- generated markdown;
- extraction facts;
- template type.

Output:

```ts
export type GroundingReview = {
  unsupportedClaims: string[];
  sensitiveLeaks: string[];
  qualityIssues: string[];
  suggestedRevision?: string;
  pass: boolean;
};
```

If severe issues exist:

- either auto-revise;
- or show warning to user before export.

---

## 14. Token and Chunking Strategy

### 14.1 Why Chunking Matters

Git diffs and ChatGPT exports can be very large. The MVP should not send everything blindly.

### 14.2 Source Ranking

Before extraction, rank sources:

1. User-selected manual notes.
2. PR title/body.
3. Commit messages.
4. Diff stats.
5. Important source files.
6. Tests and config.
7. Full patches only when needed.

### 14.3 File Filtering

Ignore or collapse:

- lock files;
- generated build output;
- minified files;
- images/binary files;
- large JSON datasets;
- package manager caches;
- `.next`, `dist`, `build`, `node_modules`.

### 14.4 Chunk Summary

For each large source chunk:

1. summarize chunk into structured facts;
2. store chunk summary;
3. combine chunk summaries into project extraction.

```text
large diff
  ↓
file chunks
  ↓
per-file summaries
  ↓
combined extraction
```

---

## 15. Redaction Architecture

### 15.1 Redaction Flow

```text
raw source
  ↓
file filter
  ↓
secret pattern scan
  ↓
redacted source text
  ↓
redaction report
  ↓
AI extraction
```

### 15.2 Secret Patterns

Detect:

```ts
export const SECRET_PATTERNS = [
  { name: "OpenAI API Key", regex: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: "GitHub Token", regex: /gh[pousr]_[A-Za-z0-9_]{30,}/g },
  { name: "JWT", regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { name: "Private Key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "Database URL", regex: /(postgres|mysql|mongodb|redis):\/\/[^\s"']+/g },
  { name: "Generic Secret Assignment", regex: /(api[_-]?key|secret|token|password)\s*=\s*["'][^"']{8,}["']/gi },
];
```

### 15.3 Redaction Output

```ts
export type RedactionResult = {
  redactedText: string;
  findings: Array<{
    type: string;
    count: number;
  }>;
  blocked: boolean;
};
```

If private keys or seed phrases are detected, the source should be blocked by default and require user review.

---

## 16. Story Templates

Templates should live in `lib/markdown/templates.ts`.

```ts
export type StoryTemplateDefinition = {
  id: StoryTemplate;
  label: string;
  description: string;
  defaultAudience: string;
  defaultTone: string;
  structure: string[];
  maxLengthHint?: string;
};
```

Example:

```ts
export const DORAHACKS_UPDATE_TEMPLATE: StoryTemplateDefinition = {
  id: "DORAHACKS_UPDATE",
  label: "DoraHacks Update",
  description: "A concise hackathon progress update for judges and ecosystem reviewers.",
  defaultAudience: "hackathon judges",
  defaultTone: "clear, technical, confident, not overhyped",
  structure: [
    "What changed since the last update",
    "Why this matters",
    "Technical implementation",
    "Current status",
    "Next milestone",
  ],
};
```

---

## 17. UI Architecture

### 17.1 Page Flow

```text
/dashboard
  ↓
/projects/[projectId]
  ↓
/projects/[projectId]/sources
  ↓
/projects/[projectId]/extract
  ↓
/projects/[projectId]/generate
  ↓
/projects/[projectId]/editor/[artifactId]
```

### 17.2 State Management

MVP can use:

- server components for initial data;
- React Hook Form for forms;
- local component state for tab flows;
- polling for story run status;
- no global state library unless needed.

### 17.3 UI Components

Important components:

- `SourceTabs` — source input method selector.
- `SourceDocumentList` — list of imported context.
- `ExtractionBoard` — editable fact board.
- `TemplateSelector` — output format chooser.
- `GenerationSettingsPanel` — tone/audience/privacy options.
- `MarkdownEditor` — editor + preview.
- `ArtifactExportActions` — copy/download.

### 17.4 Design Tokens

Suggested style:

- background: near-black or deep charcoal;
- panels: slightly lighter charcoal;
- text: warm off-white;
- accent: muted gold, amber, or electric blue, but use sparingly;
- border radius: medium;
- typography: editorial, readable;
- avoid neon overload.

---

## 18. Job Handling

### 18.1 MVP Job Table

For MVP, story generation can be synchronous for small input, but job records should still be created.

Job status fields:

- queued;
- running;
- ready;
- failed.

### 18.2 Production Workers

Use a worker system for:

- large ChatGPT export parsing;
- long diff chunking;
- multi-template generation;
- GitHub repository sync;
- webhooks.

Good options:

- BullMQ + Redis;
- Inngest;
- Trigger.dev;
- custom worker process.

---

## 19. Error Handling

### 19.1 Source Errors

Examples:

- unsupported file type;
- file too large;
- invalid JSON;
- no readable messages found;
- GitHub permission denied;
- GitHub rate limit exceeded.

### 19.2 AI Errors

Examples:

- invalid structured output;
- context too large;
- model timeout;
- safety redaction blocked source;
- unsupported generation template.

### 19.3 User-Friendly Error Copy

Bad:

> 500 Internal Server Error

Good:

> Storro could not parse this ChatGPT export. Try uploading `conversations.json` directly, or paste the relevant conversation as text.

Bad:

> GitHub API error

Good:

> Storro can access the repository metadata, but not the pull request files. Check that the token or GitHub App has Pull Requests: read permission.

---

## 20. Security Architecture

### 20.1 Authentication

MVP options:

- Auth.js with GitHub login;
- NextAuth/Auth.js for production auth;
- local demo mode for hackathon demo only.

### 20.2 Authorization

Every query must scope by `userId`.

Example:

```ts
await prisma.project.findFirst({
  where: {
    id: projectId,
    userId: session.user.id,
  },
});
```

### 20.3 Token Storage

Do not store raw tokens unencrypted.

For MVP local development, `.env` token is acceptable.

For production:

- encrypt access tokens;
- prefer GitHub App installation tokens generated on demand;
- avoid storing long-lived personal tokens;
- rotate secrets;
- keep audit logs.

### 20.4 Webhook Security

- verify `X-Hub-Signature-256`;
- use constant-time comparison;
- reject unsigned requests;
- log delivery ID;
- make webhook processing idempotent.

### 20.5 AI Data Security

- redact before API call;
- do not send private facts for public templates unless approved;
- keep source selection explicit;
- log model and request metadata, not full sensitive payloads.

---

## 21. Testing Strategy

### 21.1 Unit Tests

Test:

- ChatGPT export parser;
- git diff parser;
- secret redactor;
- source normalizer;
- markdown exporter;
- template generation helpers.

### 21.2 Integration Tests

Test:

- create project;
- create source;
- run extraction with mocked AI;
- generate artifact with mocked AI;
- save editor revision.

### 21.3 AI Evaluation Tests

Create fixtures:

- small ChatGPT note;
- small git diff;
- large diff with lock file;
- PR with bug fix;
- source containing fake secret;
- source with planned but not implemented feature.

Evaluate:

- no invented facts;
- private facts excluded;
- implementation facts extracted;
- output format correct;
- no generic AI phrases.

### 21.4 E2E Tests

Use Playwright later.

Demo path:

1. create project;
2. paste source;
3. run extraction;
4. generate article;
5. edit markdown;
6. export.

---

## 22. Observability

MVP logs:

- source created;
- redaction findings count;
- extraction started/completed;
- story run started/completed;
- GitHub import status;
- AI model used;
- token estimation if available;
- errors with safe metadata.

Production metrics:

- generation success rate;
- average generation time;
- average source size;
- redaction block rate;
- GitHub sync errors;
- user export rate.

---

## 23. Implementation Order

### Phase 1 — App Skeleton

1. Create Next.js app.
2. Add Tailwind/shadcn.
3. Add Prisma/PostgreSQL.
4. Add base layout and navigation.
5. Add project CRUD.

### Phase 2 — Manual Sources

1. Paste source form.
2. File upload.
3. Source list.
4. Source preview.
5. Redaction service.

### Phase 3 — AI Extraction

1. Define schemas.
2. Build OpenAI client.
3. Build extraction prompt.
4. Store extraction and facts.
5. Extraction review UI.

### Phase 4 — Story Generation

1. Template definitions.
2. Story plan generation.
3. Markdown generation.
4. Artifact storage.
5. Editor and preview.
6. Export/copy.

### Phase 5 — GitHub Import

1. Octokit client.
2. Repository import.
3. Commit import.
4. PR import.
5. Diff normalization.

### Phase 6 — Demo Polish

1. Seed demo data.
2. Empty states.
3. Loading states.
4. Landing page.
5. Demo script flow.

---

## 24. MVP Environment Commands

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio",
    "test": "vitest"
  }
}
```

---

## 25. Example Source-to-Story Flow

### Input Sources

1. ChatGPT note:

```text
We need a product that collects ChatGPT research, Codex changes, and GitHub commits, then writes daily build stories.
```

2. Git diff summary:

```text
Added project workspace model, source document model, source input UI, and markdown editor.
```

3. Manual note:

```text
The important decision today was to avoid scraping ChatGPT/Codex and use official exports, MCP, and GitHub data instead.
```

### Extracted Facts

```json
{
  "facts": [
    {
      "category": "product_decision",
      "text": "The MVP avoids scraping ChatGPT and Codex and relies on explicit imports and official integration paths.",
      "sourceIds": ["src_manual_1"],
      "confidence": 0.96
    },
    {
      "category": "implementation_change",
      "text": "Added project workspace and source document models.",
      "sourceIds": ["src_diff_1"],
      "filePaths": ["prisma/schema.prisma"],
      "confidence": 0.9
    }
  ]
}
```

### Generated Output

```markdown
# Building Storro: turning AI-assisted development into a real project memory

Today I focused on the core decision behind Storro: the product should not pretend to have hidden access to ChatGPT or Codex. Instead, the MVP is built around explicit developer-controlled context — pasted research notes, uploaded exports, git diffs, commits, and GitHub pull requests.

...
```

---

## 26. Official Reference Alignment

The implementation should align with official integration paths:

- ChatGPT Apps are built through Apps SDK and MCP server tools.
- ChatGPT exports can be requested from ChatGPT settings for eligible accounts and include chat history in a downloadable ZIP.
- Codex can work locally through CLI/IDE and with repositories through Codex web/GitHub workflows.
- Codex GitHub Action can run Codex in CI/CD workflows.
- GitHub Apps are preferred over OAuth apps for production because they provide fine-grained repository permissions and short-lived tokens.
- GitHub webhooks should be verified with signature validation before processing.

---

## 27. Future Architecture: MCP Server

Later, Storro can expose an MCP server for ChatGPT/Codex interactions.

### 27.1 MCP Server Responsibilities

- authenticate user;
- list projects;
- create source note;
- generate story;
- fetch artifact;
- save revision.

### 27.2 Example Tool Definition Concept

```ts
server.tool(
  "storro_ingest_research_note",
  {
    projectId: z.string(),
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string()).optional(),
  },
  async ({ projectId, title, body, tags }) => {
    const source = await sourceService.createSource({
      projectId,
      sourceType: "CHATGPT_NOTE",
      title,
      rawText: body,
      metadata: { tags },
    });

    return {
      content: [
        {
          type: "text",
          text: `Saved note ${source.id} to Storro.`,
        },
      ],
    };
  }
);
```

---

## 28. Future Architecture: Browser Extension

A browser extension can be considered later, but it must be designed carefully.

Allowed direction:

- user manually selects text;
- extension sends selected text to Storro;
- no automatic reading of all pages;
- clear permission prompts;
- no password/token capture.

Not allowed direction:

- silent scraping of ChatGPT sidebar;
- scraping Codex private UI;
- collecting user data without explicit action.

---

## 29. Technical Definition of Done

The MVP technical implementation is done when:

1. Prisma schema is implemented and migrated.
2. Project CRUD works.
3. Source paste/upload works.
4. Redaction runs before extraction.
5. Extraction produces valid structured data.
6. Extraction facts can be edited.
7. Story generation produces markdown artifacts.
8. Markdown editor saves revisions.
9. Export/copy works.
10. GitHub import works for at least commits and PRs.
11. Demo seed data exists.
12. Typecheck and lint pass.
13. No code path scrapes ChatGPT or Codex private UI.

---

## 30. Implementation Notes for Codex

When implementing this product with Codex:

1. Start with the schema and types.
2. Build source ingestion before AI generation.
3. Implement redaction early.
4. Keep AI prompts in separate files.
5. Mock AI responses during UI development.
6. Add one real AI call only after the UI flow works.
7. Keep GitHub integration read-only for MVP.
8. Do not build social posting before markdown export works.
9. Do not overbuild auth if demo speed matters; use local demo user if necessary.
10. Prioritize a beautiful end-to-end demo over many half-finished integrations.
