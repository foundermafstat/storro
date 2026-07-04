# Storro — Personal Developer Story Engine

Storro is an AI-powered developer memory and publishing engine that turns a real development workflow into polished public writing.

It connects three streams of context:

1. **ChatGPT research notes** — pasted manually, imported from a ChatGPT export, or later sent from a ChatGPT App / MCP connector.
2. **Codex work context** — local git changes, Codex-created commits/PRs, Codex GitHub Action outputs, and optional pasted Codex session summaries.
3. **GitHub repository activity** — commits, diffs, pull requests, issues, releases, and repository metadata.

From these sources, Storro generates meaningful development stories: what was built, why decisions were made, what changed in the code, what broke, what was learned, and what should happen next.

---

## Product Positioning

**One-line pitch:**

> Storro turns your ChatGPT research, Codex coding work, and GitHub activity into high-quality developer stories, hackathon updates, release notes, and social posts.

**Core user:**

A solo developer or small hackathon team that already works through ChatGPT + Codex + GitHub and wants to convert daily building into credible storytelling without starting from an empty page.

**Primary use cases:**

- Publish daily hackathon progress updates.
- Generate DoraHacks / Devpost project updates.
- Write LinkedIn posts about what was built.
- Turn a day of work into a Dev.to-style technical article.
- Produce GitHub release notes from commits and PRs.
- Keep a private build journal for future memory.

---

## Why This Exists

Developers using AI tools often produce huge amounts of useful context every day:

- ChatGPT research conversations.
- Architecture decisions.
- Codex prompts and code changes.
- Git commits.
- Pull request discussions.
- Failed attempts and fixes.

Most of this context disappears or stays scattered across tools. Storro captures it, normalizes it, and turns it into narrative output.

The product is not just a summarizer. It is a **developer storytelling system**:

```text
problem → research → decisions → implementation → bugs → result → next step
```

---

## MVP Scope

The MVP should be useful without fragile private integrations or browser scraping.

### MVP Input Sources

| Source | MVP Method | Later Method |
|---|---|---|
| ChatGPT | Paste notes, upload markdown/text/json, upload ChatGPT export JSON | ChatGPT App / MCP connector that sends selected context into Storro |
| Codex | Git diff, commits, PRs, optional pasted Codex session notes | Codex plugin, Codex GitHub Action artifacts, local wrapper script, MCP tools |
| GitHub | GitHub App / fine-grained token read access, manual diff upload | Webhooks, scheduled sync, PR comments, release publishing |

### MVP Output Formats

- Long article.
- DoraHacks update.
- Twitter/X thread.
- LinkedIn post.
- GitHub release notes.
- Private build journal.

### MVP User Flow

1. User creates a project workspace.
2. User pastes ChatGPT research notes or uploads files.
3. User connects a GitHub repository or pastes a git diff/commit log.
4. Storro extracts structured context:
   - goals;
   - decisions;
   - implementation changes;
   - bugs and blockers;
   - lessons;
   - next steps.
5. User reviews the extracted context.
6. User generates one or more article formats.
7. User edits the markdown output.
8. User exports/copies markdown.

---

## Non-Goals for MVP

These are intentionally excluded from the first build:

- No scraping of the ChatGPT web UI.
- No scraping of the Codex UI.
- No hidden browser extension that reads private pages without explicit user action.
- No automatic publishing to social networks.
- No team billing.
- No complex real-time collaboration.
- No fully automatic “listen to all my work forever” system.

The MVP must prove the core value first: **high-quality writing from real build context**.

---

## Recommended Stack

- **Framework:** Next.js App Router.
- **Language:** TypeScript.
- **UI:** Tailwind CSS + shadcn/ui.
- **Database:** PostgreSQL.
- **ORM:** Prisma.
- **Auth:** Auth.js / NextAuth or Clerk for faster MVP.
- **AI:** OpenAI Responses API with structured outputs.
- **GitHub Integration:** GitHub App for production, fine-grained personal access token for local MVP.
- **Background Jobs:** MVP can start with a database-backed job table; production should move to BullMQ / Trigger.dev / Inngest.
- **File Storage:** Local filesystem for demo; S3/R2 for production.

---

## Architecture Summary

```text
                  ┌─────────────────────────┐
                  │       Next.js UI         │
                  │ Dashboard / Editor /     │
                  │ Integrations / Export    │
                  └───────────┬─────────────┘
                              │
                              ▼
                  ┌─────────────────────────┐
                  │ Next.js Route Handlers   │
                  │ API / Webhooks / Auth    │
                  └───────────┬─────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ Ingestion Engine │ │ Story Engine     │ │ Export Engine    │
│ ChatGPT/GitHub/  │ │ extraction +     │ │ Markdown / copy  │
│ Codex context    │ │ generation       │ │ release notes    │
└─────────┬────────┘ └─────────┬────────┘ └─────────┬────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│ PostgreSQL + Prisma                                           │
│ projects, sources, documents, commits, story runs, artifacts │
└──────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### Project Workspace

A workspace is the central object in Storro. It groups source context and generated writing for one product, hackathon, repository, or build cycle.

Examples:

- `Lumen — Stellar ZK Aid Payout`
- `Pact — RWA Compliance Gate`
- `The Epic War Against AI — Reddit Game`
- `Storro — Developer Story Engine`

### Source Document

A normalized piece of imported context.

Examples:

- ChatGPT research note.
- ChatGPT export conversation.
- Git diff.
- Git commit log.
- Pull request body.
- Codex session summary.
- Manual build note.

### Extraction

The structured representation of the source material.

Storro extracts:

```ts
type BuildExtraction = {
  goals: string[];
  productContext: string[];
  technicalDecisions: string[];
  implementationChanges: string[];
  bugsAndFixes: string[];
  openQuestions: string[];
  lessons: string[];
  nextSteps: string[];
  notableFiles: Array<{
    path: string;
    reason: string;
    changeSummary: string;
  }>;
  timeline: Array<{
    timestamp?: string;
    event: string;
    sourceIds: string[];
  }>;
};
```

### Story Run

A generation job that creates one or more artifacts from selected context.

Examples:

- Long article from today’s work.
- DoraHacks update from the last 24 hours.
- GitHub release notes for a merged PR.
- LinkedIn post from a project milestone.

### Story Artifact

A generated markdown document that the user can edit and export.

---

## Development Setup

### 1. Create the app

```bash
npx create-next-app@latest storro \
  --ts \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"

cd storro
```

### 2. Install dependencies

```bash
npm install @prisma/client prisma zod openai react-hook-form @hookform/resolvers
npm install lucide-react date-fns clsx tailwind-merge
npm install next-auth
npm install @octokit/rest @octokit/auth-app @octokit/webhooks
npm install react-markdown remark-gfm
npm install -D tsx vitest @types/node
```

Install shadcn/ui:

```bash
npx shadcn@latest init
npx shadcn@latest add button card textarea input tabs badge dialog dropdown-menu separator scroll-area sheet table form select toast skeleton progress
```

### 3. Configure Prisma

```bash
npx prisma init
```

Use PostgreSQL:

```env
DATABASE_URL="postgresql://localhost:5432/storro?schema=public"
```

### 4. Required environment variables

```env
# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
APP_ENV="development"

# Database
DATABASE_URL="postgresql://localhost:5432/storro?schema=public"

# Auth
AUTH_SECRET="replace-with-local-secret"
AUTH_URL="http://localhost:3000"

# OpenAI
OPENAI_API_KEY="replace-with-openai-api-key"
OPENAI_MODEL_EXTRACTION="gpt-5.5"
OPENAI_MODEL_GENERATION="gpt-5.5"

# GitHub App - production path
GITHUB_APP_ID=""
GITHUB_APP_PRIVATE_KEY=""
GITHUB_APP_WEBHOOK_SECRET=""
GITHUB_APP_CLIENT_ID=""
GITHUB_APP_CLIENT_SECRET=""

# MVP fallback - local development only
GITHUB_PERSONAL_ACCESS_TOKEN=""
```

### 5. Run locally

```bash
npm run dev
```

### 6. Run Prisma migrations

```bash
npx prisma migrate dev --name init
```

---

## Suggested Folder Structure

```text
src/
  app/
    (app)/
      dashboard/page.tsx
      projects/page.tsx
      projects/[projectId]/page.tsx
      projects/[projectId]/sources/page.tsx
      projects/[projectId]/generate/page.tsx
      projects/[projectId]/editor/[artifactId]/page.tsx
      settings/integrations/page.tsx
    api/
      projects/route.ts
      projects/[projectId]/sources/route.ts
      projects/[projectId]/extract/route.ts
      projects/[projectId]/story-runs/route.ts
      story-runs/[runId]/route.ts
      artifacts/[artifactId]/route.ts
      exports/[artifactId]/route.ts
      integrations/github/callback/route.ts
      webhooks/github/route.ts
  components/
    app-shell/
    project/
    source-input/
    extraction/
    editor/
    story-output/
    ui/
  lib/
    ai/
      openai.ts
      prompts.ts
      schemas.ts
      extraction.ts
      generation.ts
      redaction.ts
    github/
      client.ts
      app-auth.ts
      diff.ts
      webhooks.ts
    codex/
      codex-source.ts
      local-git.ts
    chatgpt/
      export-parser.ts
      note-parser.ts
    markdown/
      templates.ts
      export.ts
    prisma.ts
    auth.ts
    logger.ts
  server/
    services/
      project-service.ts
      ingestion-service.ts
      extraction-service.ts
      story-service.ts
      artifact-service.ts
      integration-service.ts
  prisma/
    schema.prisma
```

---

## MVP Screens

### 1. Dashboard

Shows projects, recent story runs, connected repositories, and last generated articles.

### 2. Project Workspace

Central page for one project:

- project summary;
- source status;
- recent commits/PRs;
- generated artifacts;
- next suggested story.

### 3. Source Input Panel

Tabs:

- Paste ChatGPT notes.
- Upload ChatGPT export / markdown / text.
- Paste git diff.
- Import GitHub repository.
- Add manual build note.

### 4. Extraction Review

A structured board:

- Goals.
- Decisions.
- Implementation.
- Bugs.
- Lessons.
- Next steps.
- Notable files.

User can edit extracted facts before article generation.

### 5. Article Generator

Template selector:

- Long article.
- DoraHacks update.
- Twitter/X thread.
- LinkedIn post.
- GitHub release notes.
- Private journal.

Tone selector:

- Technical.
- Founder/build-in-public.
- Hackathon update.
- Investor/grant update.
- Personal diary.

### 6. Markdown Editor

Split view:

- markdown editor;
- rendered preview;
- copy/export buttons;
- variant tabs.

---

## Integration Strategy

### ChatGPT Integration

**MVP:**

- Paste selected ChatGPT notes.
- Upload `.md`, `.txt`, `.json`.
- Parse `conversations.json` from official ChatGPT export.

**Later:**

- Build a ChatGPT App using the Apps SDK.
- Expose an MCP server with tools such as:
  - `create_project`;
  - `ingest_research_note`;
  - `generate_story`;
  - `list_recent_articles`;
  - `save_story_draft`.

Important: the ChatGPT App should receive context that the user explicitly gives to it. Do not design around hidden access to the user’s entire ChatGPT sidebar.

### Codex Integration

**MVP:**

- Treat Codex output as code changes inside git.
- Read commits, branch diffs, PR descriptions, and optional pasted Codex session notes.
- Add a local `storro snapshot` CLI later to capture before/after git state and a short user note.

**Later:**

- Add a Codex plugin / MCP integration for saving build notes directly to Storro.
- Use Codex GitHub Action to generate CI artifacts: PR summary, changed files, test results, migration summary.
- Import Codex-created pull requests from GitHub.

### GitHub Integration

**MVP:**

- User connects a repository.
- Storro imports recent commits and diffs.
- User selects date range, branch, or PR.

**Production:**

- GitHub App with read-only repository access by default.
- Webhooks for push, pull request, release, and issue events.
- Optional write permissions only when user explicitly enables publishing release notes or PR comments.

---

## AI Generation Pipeline

```text
raw sources
  ↓
source normalization
  ↓
secret redaction
  ↓
chunking by source type
  ↓
structured extraction
  ↓
extraction review/edit
  ↓
story planning
  ↓
template generation
  ↓
grounded revision pass
  ↓
markdown artifact
  ↓
export/copy
```

### Step 1 — Normalize Sources

Convert all sources into a shared format:

```ts
type NormalizedSource = {
  id: string;
  projectId: string;
  sourceType: "chatgpt_note" | "chatgpt_export" | "git_diff" | "commit_log" | "pull_request" | "codex_note" | "manual_note";
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
```

### Step 2 — Redact Sensitive Content

Before sending to AI:

- remove API keys;
- remove private keys;
- remove access tokens;
- remove `.env` values;
- collapse long lock files;
- ignore generated artifacts;
- mark suspicious secrets for user review.

### Step 3 — Extract Facts

Use structured output to produce strict JSON:

- no prose;
- source IDs attached;
- confidence score;
- missing context warnings.

### Step 4 — Generate Story Plan

Build outline:

- hook;
- project context;
- what problem was solved;
- technical choices;
- implementation narrative;
- specific changed files;
- blockers and fixes;
- measurable result;
- next step.

### Step 5 — Generate Variants

Render different templates from the same structured story plan.

### Step 6 — Grounding Pass

Final pass checks:

- no unsupported claims;
- no fake metrics;
- no invented integrations;
- no overclaiming;
- article matches selected output format.

---

## Initial Database Model

Core entities:

- User.
- Project.
- SourceConnection.
- SourceDocument.
- GitRepository.
- GitCommit.
- PullRequest.
- IngestionRun.
- Extraction.
- StoryRun.
- StoryArtifact.
- EditorRevision.

Detailed schema is defined in `TECHNICAL_ARCHITECTURE.md`.

---

## API Overview

### Projects

```http
POST /api/projects
GET /api/projects
GET /api/projects/:projectId
PATCH /api/projects/:projectId
DELETE /api/projects/:projectId
```

### Sources

```http
POST /api/projects/:projectId/sources
GET /api/projects/:projectId/sources
POST /api/projects/:projectId/sources/upload
POST /api/projects/:projectId/sources/paste
```

### GitHub

```http
POST /api/projects/:projectId/github/import
GET /api/projects/:projectId/github/repositories
POST /api/webhooks/github
```

### Extraction

```http
POST /api/projects/:projectId/extract
GET /api/extractions/:extractionId
PATCH /api/extractions/:extractionId
```

### Story Runs

```http
POST /api/projects/:projectId/story-runs
GET /api/story-runs/:runId
POST /api/story-runs/:runId/regenerate
```

### Artifacts

```http
GET /api/artifacts/:artifactId
PATCH /api/artifacts/:artifactId
POST /api/artifacts/:artifactId/export
```

---

## UI Direction

Storro must not look like a generic AI dashboard.

Visual direction:

- editorial/productivity aesthetic;
- calm dark interface;
- premium typography;
- spacious layouts;
- strong markdown preview;
- source cards that feel like a research desk;
- story timeline as the main emotional element;
- subtle accent color, not rainbow gradients;
- no fake AI robot illustrations;
- no overloaded dashboard blocks.

Suggested UI metaphor:

> A private writer’s room for developers.

---

## Three-Day MVP Build Plan

### Day 1 — Foundation + Manual Inputs

- Create Next.js app.
- Add shadcn/ui.
- Add Prisma/PostgreSQL.
- Implement auth or local demo user.
- Create project workspace CRUD.
- Build source input panel.
- Support paste/upload of ChatGPT notes and git diffs.
- Store normalized source documents.

### Day 2 — GitHub + AI Pipeline

- Add GitHub repository import through token or GitHub App.
- Import recent commits and pull request data.
- Implement diff normalization and file filtering.
- Add secret redaction.
- Implement structured extraction with OpenAI.
- Build extraction review UI.
- Implement story plan generation.

### Day 3 — Article Generator + Demo Polish

- Implement templates:
  - long article;
  - DoraHacks update;
  - Twitter/X thread;
  - LinkedIn post;
  - GitHub release notes.
- Build markdown editor and preview.
- Add copy/export buttons.
- Add sample demo data.
- Add landing page.
- Add demo script flow.
- Polish UI.

---

## Codex Implementation Prompt

Use this prompt inside Codex after adding the four technical documents to the repository:

```text
You are building Storro, a Personal Developer Story Engine.

Read README.md, PRODUCT_SPEC.md, TECHNICAL_ARCHITECTURE.md, and DEMO_SCRIPT.md first.

Implement the MVP in Next.js + TypeScript + Tailwind + shadcn/ui + Prisma/PostgreSQL.

Prioritize:
1. Project workspaces.
2. Manual source ingestion: paste ChatGPT notes, upload text/markdown/json, paste git diff or commit log.
3. GitHub repository import using a local fine-grained token first, with architecture ready for GitHub App.
4. Secret redaction before AI calls.
5. Structured extraction into goals, decisions, implementation changes, bugs, lessons, next steps, notable files, timeline.
6. Story generation templates: long article, DoraHacks update, Twitter/X thread, LinkedIn post, GitHub release notes, private journal.
7. Markdown editor with preview and copy/export.
8. Premium, calm, editorial UI — not a generic AI dashboard.

Do not implement browser scraping of ChatGPT or Codex.
Do not claim automatic ChatGPT/Codex access unless it exists through explicit user-provided files, official exports, GitHub data, or a future MCP/App SDK connector.

Use clean architecture:
- UI components in /components.
- AI logic in /lib/ai.
- GitHub logic in /lib/github.
- source parsers in /lib/chatgpt, /lib/codex, /lib/markdown.
- server services in /server/services.

After each major step, run typecheck, lint, and tests if available.
```

---

## Official Integration References

These references are included so the implementation avoids fragile assumptions:

- OpenAI Apps SDK: https://developers.openai.com/apps-sdk
- Apps SDK Quickstart: https://developers.openai.com/apps-sdk/quickstart
- Connect from ChatGPT: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- ChatGPT data export: https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data
- Codex docs: https://developers.openai.com/codex
- Codex CLI: https://developers.openai.com/codex/cli
- Codex GitHub integration: https://developers.openai.com/codex/integrations/github
- Codex GitHub Action: https://developers.openai.com/codex/github-action
- OpenAI Responses API: https://developers.openai.com/api/reference/responses/overview/
- Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- File Search: https://developers.openai.com/api/docs/guides/tools-file-search
- GitHub Apps vs OAuth Apps: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
- GitHub webhooks: https://docs.github.com/en/webhooks
- GitHub webhook validation: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- GitHub REST commits API: https://docs.github.com/en/rest/commits/commits
- GitHub GraphQL API: https://docs.github.com/en/graphql

---

## Success Criteria

The MVP is successful when a developer can:

1. Create a project.
2. Add ChatGPT research notes.
3. Add git/GitHub context.
4. Generate an accurate structured build summary.
5. Generate at least five useful output formats.
6. Edit the output in markdown.
7. Export/copy the article.
8. Show a clear before/after demo in under five minutes.

---

## Product Principle

Storro should never generate generic “AI productivity” fluff.

Every article must feel like it was written from real work:

- real decisions;
- real files;
- real tradeoffs;
- real mistakes;
- real next steps.

That is the product moat.
