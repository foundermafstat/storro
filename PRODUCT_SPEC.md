# Storro — Product Specification

**Product name:** Storro  
**Product category:** AI-powered developer memory / build storytelling engine  
**Document type:** Product specification  
**Target build:** MVP  
**Primary stack:** Next.js, TypeScript, Tailwind, shadcn/ui, PostgreSQL, Prisma  

---

## 1. Product Vision

Storro transforms a developer’s scattered daily work into structured memory and polished public storytelling.

The modern AI-assisted developer workflow produces a huge amount of valuable context:

- research in ChatGPT;
- implementation in Codex;
- code history in GitHub;
- decisions hidden in prompts, diffs, commits, and PRs;
- small failures and fixes that make the story credible.

Storro captures this context and turns it into useful writing:

- long-form technical articles;
- build-in-public posts;
- hackathon progress updates;
- DoraHacks updates;
- Devpost updates;
- GitHub release notes;
- private daily build journals.

The product should feel like a **developer memory engine**, not a simple AI text generator.

---

## 2. Core Promise

> Give Storro your research notes, Codex/GitHub work, and build context. It gives you a clear, accurate, human story of what you built and why it matters.

---

## 3. Problem

Developers using AI coding tools have a new problem: they create more context than they can organize.

### Current Workflow Pain

A developer may spend a day doing this:

1. Ask ChatGPT to research a hackathon, protocol, API, or architecture.
2. Ask Codex to implement parts of the product.
3. Review diffs.
4. Fix bugs.
5. Push commits.
6. Prepare a demo.
7. Need to publish an update.

At the end of the day, the developer remembers the general direction but not all details:

- What exact decisions were made?
- What files changed?
- Which bugs were solved?
- What was the technical narrative?
- What should be shown to judges, users, or investors?
- How to write a strong update without wasting another hour?

### Existing Tools Do Not Solve This Well

| Tool | What it does | What is missing |
|---|---|---|
| ChatGPT | Helps research and write | Does not automatically know git history or project timeline unless provided |
| Codex | Helps implement code | Does not automatically create public storytelling artifacts |
| GitHub | Stores commits and PRs | Commit logs are not a human story |
| Notion/Docs | Stores notes | Requires manual writing and organization |
| Generic AI writers | Generate posts | Lack grounded development context |

---

## 4. Target Users

### 4.1 Primary Persona — Solo AI-Assisted Builder

A developer who uses ChatGPT for research and Codex for coding.

**Goals:**

- ship fast;
- document progress;
- publish credible updates;
- remember why decisions were made;
- show work to hackathon judges or grant reviewers.

**Pain:**

- too much context scattered across tools;
- hard to write after a long coding day;
- generated posts often sound generic;
- public updates miss technical depth.

### 4.2 Secondary Persona — Hackathon Team

A small team building under time pressure.

**Goals:**

- create frequent updates;
- summarize commits and PRs;
- prepare final submission story;
- produce demo script and release notes.

**Pain:**

- different people work in different tools;
- project narrative becomes unclear;
- final submission feels rushed.

### 4.3 Future Persona — Developer Advocate / Founder

A builder who wants to publish consistently.

**Goals:**

- turn product progress into content;
- write LinkedIn/Twitter threads;
- publish technical articles;
- maintain a public roadmap.

---

## 5. Product Differentiation

Storro is not another “AI blog post generator.”

Its differentiation comes from grounding writing in source context:

1. **Research context:** what the developer learned and why.
2. **Code context:** what actually changed.
3. **Decision context:** what tradeoffs were made.
4. **Timeline context:** how the work evolved.
5. **Audience context:** the same build can become a technical article, hackathon update, release note, or social post.

The product should be opinionated: it generates stories in a clear build narrative, not vague marketing copy.

---

## 6. MVP Product Goals

The MVP must prove four things:

1. Storro can ingest developer context from manual and GitHub sources.
2. Storro can extract structured build facts accurately.
3. Storro can generate useful, non-generic story outputs.
4. Storro can provide a pleasant editing/export experience.

---

## 7. MVP Feature List

### 7.1 Project Workspace

A user can create and manage project workspaces.

Each project includes:

- name;
- short description;
- repository URL;
- target audience;
- project type;
- default tone;
- default output templates;
- source documents;
- generated artifacts.

**Project types:**

- hackathon project;
- product MVP;
- open-source repository;
- client project;
- personal learning project;
- other.

**Acceptance criteria:**

- User can create a project.
- User can edit project metadata.
- User can open project dashboard.
- User can see source and story history.

---

### 7.2 Source Input Panel

A user can add source context through multiple input modes.

#### 7.2.1 Paste ChatGPT Notes

User pastes research notes or conversation excerpts.

Fields:

- title;
- source type;
- body;
- optional date;
- optional tags.

**Acceptance criteria:**

- User can paste long text.
- Text is stored as a source document.
- Source appears in project source list.
- Source can be selected for extraction.

#### 7.2.2 Upload ChatGPT Export / Text / Markdown / JSON

User uploads files.

Supported MVP formats:

- `.txt`;
- `.md`;
- `.json`;
- `.zip` only if it contains readable exported conversation JSON and the implementation supports safe extraction.

**ChatGPT export behavior:**

- User can upload `conversations.json` from an official ChatGPT export.
- Storro parses conversations into selectable source documents.
- User chooses which conversations or messages should be used.
- Storro should not automatically import everything without review.

**Acceptance criteria:**

- File is parsed safely.
- User can preview imported documents.
- User can select conversations/messages.
- Unsupported files return a clear error.

#### 7.2.3 Paste Git Diff / Commit Log

User pastes output such as:

```bash
git log --oneline --decorate -n 20
git diff main...feature-branch
git show --stat --patch <commit>
```

**Acceptance criteria:**

- System stores raw git text.
- System attempts to detect file paths and change summaries.
- Large diffs are chunked.
- Generated/lock files are ignored or collapsed.

#### 7.2.4 GitHub Repository Import

User connects or provides access to a repository.

MVP import modes:

1. Fine-grained personal access token for local MVP.
2. GitHub App-ready architecture for production.

User can import:

- repository metadata;
- latest commits;
- commit messages;
- changed files;
- PR title/body/status;
- PR diffs;
- release notes if available.

**Acceptance criteria:**

- User can enter repository owner/name or URL.
- System fetches commits for selected branch/date range.
- System fetches pull request context when selected.
- System stores normalized GitHub source documents.
- System handles rate limit and permission errors gracefully.

#### 7.2.5 Manual Build Note

User writes a short daily note:

- “What I tried.”
- “What worked.”
- “What failed.”
- “What should be mentioned publicly.”

**Acceptance criteria:**

- User can add manual notes quickly.
- Manual notes receive high priority in story generation.

---

### 7.3 Codex Context Capture

Codex integration should be realistic and staged.

#### MVP Codex Strategy

For MVP, Storro should not rely on private Codex UI scraping.

Instead, it captures Codex work through:

- git diffs;
- commits;
- PRs created after Codex work;
- optional pasted Codex session notes;
- optional local `storro snapshot` command in future.

The key idea: Codex’s useful output is reflected in repository changes. Storro turns those changes into narrative.

#### Future Codex Strategy

Future integrations can include:

- Codex GitHub Action artifacts;
- Codex plugin / MCP tools;
- Codex-created PR tracking;
- local CLI wrapper that records prompt summary + before/after diff.

**Acceptance criteria for MVP:**

- UI has a Codex source type.
- User can paste Codex session summary.
- GitHub imported PRs/commits can be marked as “Codex-assisted.”
- Story generator can phrase Codex involvement honestly: “I used Codex to accelerate implementation” only if the user marks it or source says so.

---

### 7.4 Structured Extraction

Storro extracts structured build facts from selected sources.

Extraction categories:

- project goal;
- problem being solved;
- research insights;
- technical decisions;
- implementation changes;
- files/modules changed;
- bugs/blockers;
- fixes;
- lessons learned;
- measurable progress;
- open questions;
- next steps;
- story-worthy moments.

Each extracted fact should include:

- text;
- source document IDs;
- confidence score;
- optional file path;
- optional timestamp;
- category;
- whether user edited it.

**Acceptance criteria:**

- Extraction returns structured JSON.
- User can review and edit extraction.
- Extraction view clearly separates facts from generated prose.
- Article generation uses approved extraction data.
- Unsupported claims are minimized.

---

### 7.5 Extraction Review Board

User can review extracted context before generating articles.

Board sections:

1. Goals.
2. Research and insights.
3. Product decisions.
4. Technical decisions.
5. Implementation changes.
6. Bugs and fixes.
7. Lessons learned.
8. Next steps.
9. Notable files.
10. Possible hooks.

User actions:

- edit fact;
- delete fact;
- mark fact as important;
- mark fact as private;
- add missing fact;
- collapse irrelevant fact.

**Acceptance criteria:**

- User can edit extracted facts.
- Private facts are excluded from public outputs by default.
- Important facts are prioritized in generated articles.

---

### 7.6 Article Generator

User selects output format and generation settings.

#### Output Templates

##### Long Article

Purpose: technical build story.

Structure:

1. Title.
2. Hook.
3. Problem.
4. Context.
5. Research.
6. Technical direction.
7. Implementation details.
8. Bugs/fixes.
9. Result.
10. What comes next.

##### DoraHacks Update

Purpose: concise hackathon progress update.

Structure:

1. What was built.
2. Why it matters.
3. Technical implementation.
4. Current progress.
5. Evidence / repo / demo notes.
6. Next milestone.

##### Twitter/X Thread

Purpose: build-in-public thread.

Structure:

- 6–10 tweets;
- strong first tweet;
- concrete progress;
- readable technical details;
- final next-step tweet.

##### LinkedIn Post

Purpose: professional public update.

Structure:

- short hook;
- project context;
- what was implemented;
- lesson or insight;
- next step;
- no fake corporate tone.

##### GitHub Release Notes

Purpose: repository changelog.

Structure:

- summary;
- added;
- changed;
- fixed;
- technical notes;
- known issues;
- next release.

##### Private Build Journal

Purpose: honest internal memory.

Structure:

- what I tried;
- what worked;
- what failed;
- decisions;
- emotional/energy note;
- tomorrow’s next step.

#### Generation Settings

- output format;
- tone;
- audience;
- length;
- public/private sensitivity;
- include code details yes/no;
- include file names yes/no;
- include personal reflection yes/no.

**Acceptance criteria:**

- User can generate all MVP formats.
- Generated content references actual context.
- Generated content avoids invented facts.
- Output is markdown.
- User can regenerate with different settings.

---

### 7.7 Markdown Editor and Export

The output must be editable.

Editor features:

- markdown input;
- rendered preview;
- title editing;
- copy markdown;
- copy plain text;
- download `.md`;
- export variant metadata;
- save revision history.

Future export targets:

- GitHub release draft;
- GitHub PR comment;
- Dev.to draft;
- Notion page;
- DoraHacks update copy helper;
- LinkedIn clipboard formatter.

**Acceptance criteria:**

- User can edit and save generated markdown.
- User can preview formatting.
- User can download markdown.
- Revision history stores previous generated version.

---

### 7.8 Dashboard

The dashboard should show:

- active projects;
- last imported source;
- last story generated;
- connected repositories;
- suggested action.

Suggested action examples:

- “Generate today’s build journal.”
- “Import latest GitHub commits.”
- “Review extracted decisions.”
- “Create a DoraHacks update from the last story run.”

**Acceptance criteria:**

- Dashboard is useful with one project.
- Dashboard is not overloaded.
- Empty states guide the user clearly.

---

## 8. User Journeys

### Journey 1 — Manual MVP Flow

1. User creates project “Storro”.
2. User pastes ChatGPT notes about product direction.
3. User pastes git diff from the latest implementation.
4. User clicks “Extract build context.”
5. User reviews goals, decisions, implementation, bugs, next steps.
6. User generates a long article and DoraHacks update.
7. User edits the markdown.
8. User copies final post.

### Journey 2 — GitHub Import Flow

1. User creates project.
2. User connects GitHub repository.
3. User selects branch or PR.
4. Storro imports commits, changed files, PR body, and diff stats.
5. User adds optional manual note.
6. Storro generates release notes and LinkedIn post.

### Journey 3 — Hackathon Final Update

1. User selects project and date range.
2. User imports all commits from last 3 days.
3. User selects best research notes.
4. User generates:
   - final project story;
   - DoraHacks update;
   - demo script;
   - Twitter thread.
5. User exports artifacts.

### Journey 4 — Future ChatGPT App Flow

1. User opens ChatGPT.
2. User invokes Storro app.
3. User says: “Save this research as a Storro note under project Lumen.”
4. ChatGPT calls Storro MCP tool.
5. Storro saves selected context.
6. Later, user generates a story in Storro web app.

Important: this flow depends on explicit user action and official ChatGPT App/MCP integration.

---

## 9. Functional Requirements

### FR-001 Project Creation

User can create a project workspace with name, description, repo URL, and project type.

### FR-002 Source Document Creation

User can create source documents through paste input.

### FR-003 File Upload

User can upload text/markdown/json files as sources.

### FR-004 ChatGPT Export Parsing

User can import selected conversations from `conversations.json`.

### FR-005 Git Diff Parsing

System can parse raw git diff text and detect changed file sections.

### FR-006 GitHub Repository Import

System can import commits and pull request context from GitHub.

### FR-007 Secret Redaction

System redacts sensitive data before AI processing.

### FR-008 Structured Extraction

System creates structured extraction JSON from selected sources.

### FR-009 Extraction Editing

User can edit extracted facts before generation.

### FR-010 Article Generation

System generates markdown artifacts for selected templates.

### FR-011 Artifact Editing

User can edit and save generated markdown.

### FR-012 Export

User can copy or download markdown.

### FR-013 Revision History

System stores generated and edited versions.

### FR-014 Source Traceability

Important claims in extraction should link back to source documents where possible.

### FR-015 Privacy Controls

User can mark sources/facts as private; private facts are excluded from public templates by default.

---

## 10. Non-Functional Requirements

### NFR-001 Accuracy

Generated articles must be grounded in provided sources. The system should avoid invented details.

### NFR-002 Privacy

The system must not send secrets or private keys to AI providers. Redaction must run before AI calls.

### NFR-003 Performance

For MVP:

- small source extraction should complete in less than 30 seconds;
- long diff extraction may be chunked;
- UI should show progress states.

### NFR-004 Reliability

Failed AI calls should not destroy user input. All source documents must be saved before processing.

### NFR-005 Maintainability

AI prompts, schemas, and templates should be separated from UI components.

### NFR-006 Extensibility

Architecture must support future integrations:

- ChatGPT App / MCP connector;
- Codex plugin;
- GitHub App webhooks;
- Notion export;
- Dev.to export;
- team workspaces.

---

## 11. Data Model Summary

### Project

Represents one product/repository/workflow.

### SourceDocument

Raw or normalized imported source.

### SourceConnection

External connection such as GitHub.

### Extraction

Structured facts extracted from selected source documents.

### StoryRun

Generation job with selected template, settings, and source set.

### StoryArtifact

Generated markdown output.

### EditorRevision

Saved edits of generated artifacts.

---

## 12. AI Behavior Requirements

### 12.1 Extraction Model Behavior

The extraction model must:

- return JSON only;
- include source references;
- avoid writing article prose;
- flag unclear information;
- distinguish user intent from implemented code;
- separate product decisions from technical changes;
- mark assumptions explicitly.

### 12.2 Generation Model Behavior

The generation model must:

- write in natural human style;
- avoid generic AI phrases;
- ground claims in extraction facts;
- not invent metrics;
- not overstate completion;
- preserve uncertainty where needed;
- produce markdown.

### 12.3 Forbidden Output Patterns

Avoid:

- “In today’s fast-paced digital world...”
- “This groundbreaking solution revolutionizes...”
- “Seamlessly leverages cutting-edge AI...”
- vague claims without implementation details;
- fake user numbers;
- fake partnerships;
- fake benchmarks;
- invented blockchain/testnet transactions;
- unsupported claims that something is production-ready.

---

## 13. Template Requirements

### 13.1 Long Article Template

Fields:

- title;
- subtitle;
- tags;
- reading time;
- markdown body;
- source summary;
- private/public safety flag.

Quality rules:

- must have a concrete hook;
- must explain why the build matters;
- must include technical specifics;
- must include a “what changed” section;
- must include a “next step” section.

### 13.2 DoraHacks Update Template

Quality rules:

- clear progress milestone;
- built features listed concretely;
- short technical explanation;
- no excessive marketing;
- suitable for hackathon judges.

### 13.3 Twitter/X Thread Template

Quality rules:

- first tweet must be strong;
- each tweet should stand alone;
- avoid giant paragraphs;
- include one technical detail per 1–2 tweets;
- final tweet should point to next step.

### 13.4 LinkedIn Template

Quality rules:

- professional but not corporate;
- useful lesson or insight;
- concise paragraphs;
- no cringe motivational tone.

### 13.5 GitHub Release Notes Template

Quality rules:

- clear changelog categories;
- file/module details where useful;
- no narrative exaggeration;
- mention breaking changes if detected.

---

## 14. Privacy and Safety Requirements

Storro handles sensitive developer data. It must be designed with privacy from day one.

### 14.1 Secret Detection

Detect and redact:

- OpenAI keys;
- GitHub tokens;
- JWTs;
- private keys;
- SSH keys;
- `.env` values;
- database URLs;
- wallet private keys and seed phrases;
- API tokens;
- OAuth secrets;
- webhook secrets.

### 14.2 Private Facts

User can mark a fact as private.

Private facts:

- remain visible in private journal;
- are excluded from public templates by default;
- can be manually included only with explicit user action.

### 14.3 No Hidden Data Access

The product must not imply it has automatic access to private ChatGPT or Codex sessions unless implemented through official, user-authorized mechanisms.

### 14.4 GitHub Permissions

Default permissions should be read-only:

- repository metadata;
- contents read;
- pull requests read;
- issues read optional;
- actions read optional.

Write permissions should be separated and optional.

---

## 15. UX Principles

### 15.1 Source First, AI Second

The interface should emphasize sources and facts before generated text.

### 15.2 User Controls the Story

The user should be able to edit extracted facts before generation.

### 15.3 No Black Box Magic

Show what source documents were used.

### 15.4 Fast Path for Tired Developers

The product should support a fast workflow:

1. paste notes;
2. paste diff;
3. generate story;
4. copy.

### 15.5 Premium but Practical UI

Design should be calm, clean, editorial, and useful.

---

## 16. UI Specification

### 16.1 Visual Style

- dark editorial interface;
- high contrast text;
- soft panels;
- restrained accent color;
- spacious source cards;
- markdown-first editor;
- subtle progress animations;
- no generic AI avatars.

### 16.2 Main Navigation

Sidebar:

- Dashboard;
- Projects;
- New Story;
- Sources;
- Artifacts;
- Integrations;
- Settings.

### 16.3 Empty States

Good empty states are important.

Examples:

- “Start with what you already have: paste ChatGPT notes or a git diff.”
- “Connect GitHub when you want Storro to read commits and PRs automatically.”
- “No articles yet. Generate your first build story from selected sources.”

### 16.4 Status Labels

Source status:

- uploaded;
- parsed;
- redacted;
- extracted;
- used in story;
- excluded;
- private.

Story status:

- draft;
- generating;
- ready;
- edited;
- exported;
- failed.

---

## 17. MVP Pages

### `/dashboard`

Overview of projects and recent activity.

### `/projects`

Project list.

### `/projects/new`

Create project.

### `/projects/[projectId]`

Project overview.

### `/projects/[projectId]/sources`

Input and source management.

### `/projects/[projectId]/extract`

Extraction run and review board.

### `/projects/[projectId]/generate`

Template selection and generation.

### `/projects/[projectId]/editor/[artifactId]`

Markdown editor and export.

### `/settings/integrations`

GitHub/OpenAI settings and future connector status.

---

## 18. Success Metrics

### MVP Product Metrics

- Time from source input to first article: under 3 minutes for small context.
- User can generate at least 5 output formats.
- User edits less than 30% of generated content before using it.
- User can complete demo flow without developer intervention.

### Quality Metrics

- Article contains at least 5 concrete facts from source context.
- Article mentions real implementation changes.
- Article avoids unsupported claims.
- Release notes match commit/diff data.

### User Value Metrics

- User says the output is publishable with light edits.
- User reuses generated content for at least one real platform.
- User imports context again the next day.

---

## 19. MVP Risks

### Risk 1 — Generic AI Output

**Problem:** generated articles sound like generic AI marketing.

**Mitigation:**

- force structured extraction before generation;
- require concrete facts;
- include source-grounded technical details;
- add final anti-fluff rewrite pass.

### Risk 2 — Hallucinated Claims

**Problem:** model invents features, metrics, or completion status.

**Mitigation:**

- generation must use approved extraction only;
- add unsupported claim detection;
- use “unknown” where data is missing;
- never invent metrics.

### Risk 3 — Sensitive Data Leakage

**Problem:** source diffs may contain secrets.

**Mitigation:**

- redaction before AI call;
- file ignore rules;
- private fact flags;
- show redaction warnings.

### Risk 4 — Integration Complexity

**Problem:** ChatGPT/Codex direct integration may be misunderstood.

**Mitigation:**

- MVP uses manual import and GitHub;
- official connector path documented separately;
- no scraping.

### Risk 5 — GitHub API Permissions

**Problem:** user is uncomfortable granting repo access.

**Mitigation:**

- support manual diff paste;
- use read-only permissions;
- allow selecting specific repositories;
- show exactly what is imported.

---

## 20. Release Plan

### Version 0.1 — Manual Story Engine

- project workspace;
- paste notes;
- paste git diff;
- extraction;
- article templates;
- editor/export.

### Version 0.2 — GitHub Import

- connect repository;
- import commits/PRs;
- diff summarization;
- release notes.

### Version 0.3 — ChatGPT Export Import

- parse ChatGPT export JSON;
- conversation selector;
- message filtering.

### Version 0.4 — Daily Build Journal

- date range selection;
- daily timeline;
- private journal template.

### Version 0.5 — ChatGPT App / MCP Prototype

- Storro MCP server;
- save selected notes from ChatGPT;
- generate story from ChatGPT.

### Version 0.6 — Codex Workflow Integration

- Codex GitHub Action artifacts;
- local snapshot CLI;
- Codex plugin path.

---

## 21. Monetization Ideas

Not required for MVP, but product can grow into a paid developer tool.

### Free Tier

- manual paste;
- limited stories per month;
- markdown export.

### Pro Tier

- GitHub integration;
- unlimited projects;
- longer source context;
- template library;
- ChatGPT export parsing;
- private build journals.

### Team Tier

- shared workspaces;
- team source aggregation;
- release notes workflow;
- approval system;
- branded templates.

### Hackathon Pack

- final submission generator;
- demo script generator;
- DoraHacks/Devpost templates;
- daily update timeline.

---

## 22. Definition of Done for MVP

The MVP is done when:

1. A user can create a project.
2. A user can add at least two source types.
3. A user can run structured extraction.
4. A user can edit extracted facts.
5. A user can generate at least five article formats.
6. A user can edit markdown.
7. A user can export/copy output.
8. A demo can be completed in under five minutes.
9. Redaction runs before AI calls.
10. The UI feels polished enough to show publicly.

---

## 23. Product North Star

The best Storro output should make a developer think:

> “Yes, this is exactly what I built today — but written better than I had energy to write it myself.”

