# Storro — Demo Script

**Product:** Storro — Personal Developer Story Engine  
**Demo goal:** Show that Storro turns ChatGPT research + Codex/GitHub development context into useful developer storytelling artifacts.  
**Recommended demo length:** 4–6 minutes  
**Audience:** hackathon judges, developers, AI tool users, grant reviewers, build-in-public founders  

---

## 1. Demo Narrative

The demo should tell one clear story:

> Developers using ChatGPT and Codex build fast, but their thinking and implementation history become scattered. Storro collects that context and turns it into a grounded, human development story.

The demo must show:

1. Real source input.
2. Structured extraction.
3. Generation of multiple article formats.
4. Markdown editing/export.
5. Clear integration path with GitHub and future ChatGPT/Codex connectors.

---

## 2. Demo Setup

### 2.1 Demo Project

Use project name:

```text
Storro — Personal Developer Story Engine
```

Project description:

```text
An AI-powered developer memory system that turns ChatGPT research, Codex-assisted coding, and GitHub activity into polished build stories, hackathon updates, release notes, and social posts.
```

Project type:

```text
Product MVP
```

Default audience:

```text
Developers and hackathon judges
```

Default tone:

```text
Clear, technical, human, build-in-public
```

---

## 3. Demo Data

Create a `/demo-data` folder in the repository.

```text
demo-data/
  chatgpt-research-notes.md
  codex-session-note.md
  git-diff-sample.patch
  commit-log-sample.txt
  pr-description-sample.md
```

### 3.1 `chatgpt-research-notes.md`

```markdown
# ChatGPT Research Notes — Storro MVP

Goal: build an MVP called Storro / DevStory Engine.

The user workflow is:
1. Research and product thinking happens in ChatGPT.
2. Implementation happens with Codex.
3. Real code history lives in GitHub.
4. At the end of the day, the developer needs public storytelling: article, DoraHacks update, LinkedIn post, X thread, release notes.

Important product decision:
Do not scrape the ChatGPT or Codex private UI. Start with explicit user-provided context: paste notes, upload ChatGPT export JSON, paste git diff, import GitHub repository data. Later, build official connectors through Apps SDK / MCP and Codex plugin paths.

MVP features:
- Project workspace.
- Source input panel.
- ChatGPT notes import.
- Git diff / commit log import.
- GitHub repository import.
- Structured extraction of goals, decisions, implementation changes, bugs, lessons, and next steps.
- Article generator with templates.
- Markdown editor and export.
- Premium UI, not AI-looking.

Output formats:
- Long article.
- DoraHacks update.
- Twitter/X thread.
- LinkedIn post.
- GitHub release notes.
- Private daily journal.
```

### 3.2 `codex-session-note.md`

```markdown
# Codex Session Note

Today Codex was used to scaffold the Storro MVP documentation and plan the implementation structure.

Important implementation choices:
- Next.js App Router for frontend and API route handlers.
- Prisma/PostgreSQL for persistence.
- shadcn/ui for a clean component-based interface.
- OpenAI structured outputs for extraction.
- GitHub App-ready architecture, with a local token fallback for MVP.
- Redaction service before AI processing.

Codex should implement the app in phases:
1. Project workspace and source ingestion.
2. Redaction and parsers.
3. Structured extraction.
4. Article generation.
5. Markdown editor.
6. GitHub import.
```

### 3.3 `commit-log-sample.txt`

```text
7ad3c21 docs: add product spec for Storro developer story engine
52e9f10 feat: add source document model and project workspace schema
9bc11a4 feat: implement source input tabs for ChatGPT notes and git diffs
1d44cc2 feat: add OpenAI extraction schema and prompt module
f021aa8 feat: add markdown artifact editor and preview
c9a65de chore: add demo data for Storro story generation
```

### 3.4 `git-diff-sample.patch`

```diff
diff --git a/prisma/schema.prisma b/prisma/schema.prisma
+model Project {
+  id          String   @id @default(cuid())
+  name        String
+  description String?
+  sources     SourceDocument[]
+  artifacts   StoryArtifact[]
+  createdAt   DateTime @default(now())
+}
+
+model SourceDocument {
+  id        String   @id @default(cuid())
+  projectId String
+  type      String
+  title     String
+  rawText   String
+  createdAt DateTime @default(now())
+}
+
+model StoryArtifact {
+  id        String   @id @default(cuid())
+  projectId String
+  template  String
+  title     String
+  markdown  String
+  createdAt DateTime @default(now())
+}

diff --git a/src/lib/ai/schemas.ts b/src/lib/ai/schemas.ts
+export const extractionCategories = [
+  "goal",
+  "technical_decision",
+  "implementation_change",
+  "bug_or_blocker",
+  "lesson",
+  "next_step",
+] as const;
+
+export type ExtractionCategory = typeof extractionCategories[number];

diff --git a/src/components/source-input/source-tabs.tsx b/src/components/source-input/source-tabs.tsx
+export function SourceTabs() {
+  return (
+    <Tabs defaultValue="chatgpt">
+      <TabsList>
+        <TabsTrigger value="chatgpt">ChatGPT Notes</TabsTrigger>
+        <TabsTrigger value="git">Git Diff</TabsTrigger>
+        <TabsTrigger value="github">GitHub</TabsTrigger>
+        <TabsTrigger value="manual">Manual Note</TabsTrigger>
+      </TabsList>
+    </Tabs>
+  );
+}
```

### 3.5 `pr-description-sample.md`

```markdown
# PR: Build the first Storro MVP flow

This PR adds the foundation for Storro:

- project workspace data model;
- source document ingestion model;
- source input tabs for ChatGPT notes, git diffs, GitHub imports, and manual notes;
- extraction categories for AI structured output;
- markdown artifact model for generated articles.

The implementation intentionally avoids private UI scraping. The product starts with explicit user-provided context and GitHub repository data.

Next step: implement the AI extraction endpoint and markdown editor.
```

---

## 4. Demo Flow Overview

```text
Opening problem
  ↓
Create/open project workspace
  ↓
Paste ChatGPT research notes
  ↓
Add Codex/GitHub context
  ↓
Run structured extraction
  ↓
Review extracted facts
  ↓
Generate article variants
  ↓
Edit markdown
  ↓
Export/copy
  ↓
Close with integration roadmap
```

---

## 5. Full Demo Script — 5 Minutes

### 0:00–0:30 — Opening

**Say:**

> Storro is a personal developer story engine. It solves a problem that appears when you build with ChatGPT, Codex, and GitHub: the work happens fast, but the story of the work gets lost. Research is in ChatGPT, implementation is in Codex, and proof is in GitHub. Storro brings that context together and turns it into articles, hackathon updates, release notes, and social posts.

**Show:**

- Landing page or dashboard.
- One-line product pitch.
- Main CTA: “Create build story.”

---

### 0:30–1:00 — Project Workspace

**Action:**

Open or create project:

```text
Storro — Personal Developer Story Engine
```

**Say:**

> Everything starts with a project workspace. A workspace groups research notes, code changes, pull requests, extracted decisions, and generated writing for one product or hackathon build.

**Show:**

- project title;
- project description;
- source count;
- latest story runs;
- empty state or recent activity.

---

### 1:00–1:45 — Add ChatGPT Research Notes

**Action:**

Open Source Input → ChatGPT Notes tab. Paste content from `demo-data/chatgpt-research-notes.md`.

**Say:**

> First, I add the research and product thinking from ChatGPT. For the MVP, Storro does not scrape the ChatGPT interface. The user explicitly pastes notes or uploads exported conversation data. Later, this can become a ChatGPT App / MCP connector, but the first version is intentionally safe and controllable.

**Show:**

- title field;
- pasted notes;
- source saved state;
- source appears in list.

**Important visual moment:**

The source card should show:

```text
Source type: ChatGPT Note
Status: Saved
Privacy: Public-safe by default
```

---

### 1:45–2:20 — Add Codex/GitHub Context

**Action:**

Add Codex session note and git diff sample.

Option A for fastest demo:

- paste `codex-session-note.md` under Codex Note;
- paste `git-diff-sample.patch` under Git Diff.

Option B if GitHub integration is implemented:

- import sample repository or PR;
- select latest commits or PR.

**Say:**

> Next, I add implementation context. In the MVP, Codex context comes from what Codex actually changed: git diffs, commits, PRs, and optional session notes. That keeps the story grounded in real code instead of vague memory.

**Show:**

- Git diff pasted/imported;
- file paths detected;
- source type tags;
- commit log or PR context.

**Important visual moment:**

Show detected files:

```text
prisma/schema.prisma
src/lib/ai/schemas.ts
src/components/source-input/source-tabs.tsx
```

---

### 2:20–3:10 — Run Structured Extraction

**Action:**

Click “Extract build context.”

**Say:**

> Storro does not jump straight from raw text to a blog post. First it extracts structured facts: goals, decisions, implementation changes, bugs, lessons, and next steps. This is what makes the generated writing feel specific and credible.

**Show:**

Extraction board with sections.

Expected extracted facts:

#### Goals

- Build an MVP that turns ChatGPT research, Codex coding context, and GitHub activity into developer stories.

#### Product Decisions

- Avoid private UI scraping.
- Use explicit user-provided context and official integration paths.
- Start with paste/upload/GitHub import.

#### Technical Decisions

- Next.js App Router.
- Prisma/PostgreSQL.
- shadcn/ui.
- OpenAI structured outputs.
- GitHub App-ready architecture.
- Redaction before AI calls.

#### Implementation Changes

- Added project workspace model.
- Added source document model.
- Added story artifact model.
- Added source input tabs.
- Added extraction categories.

#### Next Steps

- Implement AI extraction endpoint.
- Implement markdown editor.
- Add GitHub import.

**Important visual moment:**

Edit one extracted fact manually. Mark it important.

**Say:**

> The user can edit the extracted facts before generation. That keeps the user in control of the narrative.

---

### 3:10–4:10 — Generate Article Variants

**Action:**

Open generator. Select templates:

- Long Article;
- DoraHacks Update;
- LinkedIn Post;
- GitHub Release Notes.

Click generate.

**Say:**

> From the same structured build memory, Storro can create different outputs for different audiences. A hackathon judge needs a concise progress update. A developer audience may need a long technical story. GitHub users need release notes.

**Show generated outputs.**

Expected Long Article title example:

```markdown
# Building Storro: turning AI-assisted development into real project memory
```

Expected DoraHacks update opening:

```markdown
This update focuses on the foundation of Storro: a developer memory engine that converts ChatGPT research, Codex-assisted implementation context, and GitHub activity into structured build stories.
```

Expected GitHub release notes:

```markdown
## Added
- Project workspace data model.
- Source document ingestion model.
- Story artifact model.
- Source input tabs for ChatGPT notes, git diffs, GitHub context, and manual notes.

## Changed
- Defined the MVP integration strategy around explicit source import instead of private UI scraping.

## Next
- Implement structured extraction endpoint.
- Add markdown editor and export flow.
```

---

### 4:10–4:45 — Markdown Editor and Export

**Action:**

Open generated long article in editor.

Perform a small edit:

- change title;
- add one sentence;
- remove one paragraph.

Click copy/download markdown.

**Say:**

> The output is not locked inside the AI system. It becomes a normal markdown artifact that the developer can edit, copy, export, and reuse anywhere.

**Show:**

- split editor/preview;
- save status;
- copy button;
- markdown download.

---

### 4:45–5:20 — Integration Roadmap Close

**Say:**

> The MVP starts with explicit imports because that is reliable and safe. The next layer is GitHub App sync and webhooks. After that, Storro can become a ChatGPT App through MCP tools, so selected research can be saved directly from ChatGPT. Codex context can come through GitHub PRs, Codex Action artifacts, and later a Codex plugin. The core idea stays the same: real work in, grounded story out.

**Show:**

- Integrations page with statuses:
  - ChatGPT: manual/export now, MCP later;
  - Codex: git/PR notes now, plugin/action later;
  - GitHub: repository import now, webhooks later.

**Final line:**

> Storro is for builders who already do the work — and need the story of that work to be just as strong as the code.

---

## 6. Short Demo Script — 2 Minutes

Use this for a fast hackathon pitch.

### 0:00–0:20

> Storro turns AI-assisted development into publishable developer stories. It takes ChatGPT research, Codex/GitHub implementation context, and generates articles, hackathon updates, social posts, and release notes.

### 0:20–0:45

Show project workspace and paste ChatGPT notes.

> Here I add the research context. The MVP uses explicit paste or export import, not private UI scraping.

### 0:45–1:10

Paste git diff / import GitHub PR.

> Then I add implementation evidence: diffs, commits, PR descriptions, and optional Codex session notes.

### 1:10–1:35

Run extraction.

> Storro extracts structured facts first: goals, decisions, code changes, bugs, lessons, and next steps.

### 1:35–1:55

Generate article variants.

> From the same build memory, it creates a long article, DoraHacks update, LinkedIn post, X thread, and release notes.

### 1:55–2:00

Show export.

> Real work in, grounded story out.

---

## 7. What Judges Should Notice

Make sure the demo highlights these points:

1. **Specificity:** The output references real files and implementation decisions.
2. **Safety:** No scraping; explicit user-controlled inputs.
3. **Workflow fit:** It matches how AI-assisted developers already work.
4. **Multi-output leverage:** One context pack creates many useful artifacts.
5. **Product potential:** Hackathon builders, indie hackers, dev advocates, and teams all need this.

---

## 8. Demo UI Checklist

Before recording or presenting, confirm:

- [ ] Dashboard loads cleanly.
- [ ] Project workspace exists.
- [ ] Source input tabs work.
- [ ] Demo data can be pasted quickly.
- [ ] Extraction completes or demo fallback data is available.
- [ ] Extraction board has convincing facts.
- [ ] Article generator shows all templates.
- [ ] Markdown editor works.
- [ ] Copy/download works.
- [ ] No broken buttons visible.
- [ ] No raw API errors visible.
- [ ] UI does not look like a generic AI dashboard.

---

## 9. Demo Fallback Plan

If AI generation fails during live demo:

1. Use pre-generated extraction fixture.
2. Use pre-generated artifacts stored in demo data.
3. Say:

> For the live demo, I will load a saved generation run so the flow is stable. This is the same output format produced by the extraction and generation pipeline.

Create fallback files:

```text
demo-data/generated-extraction.json
demo-data/generated-long-article.md
demo-data/generated-dorahacks-update.md
demo-data/generated-linkedin-post.md
demo-data/generated-release-notes.md
```

---

## 10. Pre-Generated Long Article Example

```markdown
# Building Storro: turning AI-assisted development into real project memory

AI-assisted development creates a strange new problem: the work moves faster than the story of the work.

During a normal build session, research may happen in ChatGPT, implementation may happen with Codex, and the final evidence lives in GitHub commits and pull requests. By the end of the day, the developer has made decisions, fixed problems, changed files, and learned things — but the context is scattered.

Storro is designed to collect that context and turn it into a clear developer story.

## The core decision

The most important product decision was to avoid scraping private ChatGPT or Codex interfaces. Instead, the MVP starts with explicit user-controlled inputs: pasted ChatGPT notes, uploaded exports, git diffs, commit logs, pull request descriptions, and GitHub repository imports.

This keeps the product safer, more reliable, and easier to demo.

## What changed in the implementation

The first MVP foundation added the main data objects needed for the product:

- project workspaces;
- source documents;
- story artifacts;
- extraction categories;
- source input tabs for ChatGPT notes, git diffs, GitHub context, and manual notes.

The early schema defines how Storro stores project memory before generating any article. This matters because the quality of the writing depends on the quality of the structured context.

## Technical direction

The MVP uses Next.js, TypeScript, Prisma, PostgreSQL, Tailwind, and shadcn/ui. The AI layer is designed around structured extraction before generation, so the system can separate facts from prose.

The source pipeline is:

```text
raw source → redaction → structured extraction → story plan → markdown artifact
```

That structure is what prevents the product from becoming a generic AI writer.

## What comes next

The next implementation step is to build the extraction endpoint, connect it to the review board, and generate the first set of markdown artifacts: long article, DoraHacks update, LinkedIn post, X thread, and GitHub release notes.

Storro's goal is simple: real work in, grounded story out.
```

---

## 11. Pre-Generated DoraHacks Update Example

```markdown
# Storro MVP Update — Developer Story Engine Foundation

This update establishes the foundation for Storro, an AI-powered developer memory engine that converts ChatGPT research, Codex-assisted coding context, and GitHub activity into polished build stories.

## What was built

The MVP structure now includes:

- project workspaces;
- source document ingestion;
- support for ChatGPT notes, git diffs, GitHub context, and manual notes;
- extraction categories for goals, technical decisions, implementation changes, blockers, lessons, and next steps;
- markdown artifact model for generated articles and updates.

## Key product decision

The MVP intentionally avoids scraping private ChatGPT or Codex interfaces. Instead, it starts with explicit user-controlled inputs and GitHub repository data. This creates a safer and more realistic integration path.

## Technical direction

Storro is designed with Next.js, TypeScript, Prisma/PostgreSQL, Tailwind, shadcn/ui, and OpenAI structured outputs. The core pipeline is source ingestion → redaction → structured extraction → story generation → markdown export.

## Next milestone

The next milestone is implementing the extraction endpoint, markdown editor, and first article generation templates.
```

---

## 12. Pre-Generated LinkedIn Post Example

```markdown
Today I started building Storro — a personal developer story engine for the AI-assisted coding workflow.

The problem is simple: when you build with ChatGPT, Codex, and GitHub, the work moves fast, but the story gets scattered.

Research lives in ChatGPT. Implementation happens through Codex. The proof lives in commits and pull requests. By the end of the day, you have real progress, but turning it into a clear update still takes energy.

Storro is designed to connect those pieces and generate grounded writing:

- long technical articles;
- hackathon updates;
- LinkedIn posts;
- X threads;
- GitHub release notes;
- private build journals.

The key product decision for the MVP: no private UI scraping. The first version uses explicit user-controlled inputs — pasted notes, exported conversations, git diffs, commit logs, and GitHub repository data.

Real work in. Grounded story out.
```

---

## 13. Pre-Generated Release Notes Example

```markdown
# Release Notes — Storro MVP Foundation

## Added

- Project workspace model.
- Source document model.
- Story artifact model.
- Source input tabs for ChatGPT notes, git diffs, GitHub imports, and manual notes.
- Extraction category definitions for goals, decisions, implementation changes, blockers, lessons, and next steps.
- Demo data for story generation.

## Changed

- Defined the MVP integration strategy around explicit user-controlled context instead of private UI scraping.
- Structured the product around source ingestion → extraction → story generation → markdown export.

## Technical Notes

- Planned stack: Next.js, TypeScript, Tailwind, shadcn/ui, Prisma, PostgreSQL, OpenAI structured outputs, GitHub API.
- GitHub integration should start read-only and later move to a GitHub App with webhooks.

## Next

- Implement AI extraction endpoint.
- Build extraction review board.
- Add markdown editor and export.
- Add GitHub commit/PR import.
```

---

## 14. Recording Tips

- Keep cursor movement slow.
- Do not show API keys or `.env` files.
- Use zoom level 110–125%.
- Hide browser bookmarks if messy.
- Prepare source text in separate tabs for fast copy/paste.
- Use a clean demo project with only relevant data.
- Do not spend time explaining every field.
- Focus on the transformation: scattered context → structured facts → polished story.

---

## 15. Final Pitch Lines

Use one of these at the end:

> Storro is not another AI writer. It is memory for the way developers actually build with AI.

> ChatGPT helps you think. Codex helps you build. GitHub stores what changed. Storro turns all of it into the story of your progress.

> Every developer building with AI has a hidden archive of decisions, bugs, fixes, and breakthroughs. Storro turns that archive into useful writing.

