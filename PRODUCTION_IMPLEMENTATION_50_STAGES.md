# Storro — Production Implementation Plan in 50 Stages

**Document type:** production implementation plan  
**Scope:** full commercial product, not MVP  
**Base documents:** `README.md`, `PRODUCT_SPEC.md`, `TECHNICAL_ARCHITECTURE.md`, `DEMO_SCRIPT.md`  

## Production Position

Storro is implemented as a production-grade developer memory and publishing platform. The system must be built for real customers, paid plans, secure integrations, async processing, auditability, observability, and scale from the first architecture pass.

This plan intentionally excludes MVP shortcuts:

- no private ChatGPT or Codex UI scraping;
- no local-only source storage;
- no long-running synchronous AI jobs;
- no personal GitHub token as the main production path;
- no unencrypted token storage;
- no direct UI access to Prisma;
- no AI generation without redaction, traceability, and grounding checks.

## Chosen Production Stack

- **Application:** Next.js App Router, React, TypeScript strict mode.
- **UI:** Tailwind CSS, shadcn/ui, lucide-react, React Hook Form.
- **Database:** PostgreSQL with Prisma migrations.
- **Queue:** Redis + BullMQ for async ingestion, extraction, generation, webhook processing, and exports.
- **Object storage:** S3/R2-compatible storage for uploaded files, exports, large source payloads, and generated artifacts.
- **Auth:** NextAuth/Auth.js for user identity and session management, with Storro-owned organizations, memberships, and RBAC.
- **Authorization:** internal RBAC and resource scoping by `orgId`, `projectId`, and role.
- **Payments:** Stripe Billing with plans, quotas, invoices, and webhook reconciliation.
- **AI:** OpenAI Responses API with structured outputs, schema validation, model routing, retry policy, and usage accounting.
- **GitHub:** GitHub App with installation tokens, read-only default permissions, verified webhooks, optional write permissions per feature.
- **ChatGPT:** future ChatGPT App through Apps SDK + Storro MCP server.
- **Codex:** GitHub evidence, Codex GitHub Action artifacts, local CLI snapshots, and later Codex plugin/MCP path.
- **Observability:** OpenTelemetry, Sentry, structured logs, metrics, job traces, audit logs.
- **Analytics:** product events with privacy-safe metadata.
- **Testing:** unit, integration, contract, E2E, AI evaluation tests, webhook replay tests, security regression checks.
- **Deployment:** Vercel or equivalent for web, separate worker service, managed PostgreSQL, managed Redis, object storage, CI/CD with environment promotion.

## System Implementation Flow

The target production pipeline is:

```text
explicit source input
  -> source storage
  -> normalization
  -> file filtering
  -> redaction
  -> chunking
  -> structured extraction
  -> human review
  -> story planning
  -> generation
  -> grounding review
  -> versioned artifact
  -> export / publish / reuse
```

## 50 Implementation Stages

### Stage 01 — Production Architecture Baseline

**Goal:** lock the production architecture, module boundaries, and non-MVP assumptions before code generation.

**Implementation prompt:**  
Create a production architecture baseline for Storro. Define the final stack, runtime topology, service boundaries, environment tiers, data ownership rules, integration principles, async processing policy, and security constraints. Produce ADR files for: auth provider, GitHub App strategy, queue choice, object storage, AI provider abstraction, and deployment topology. Remove MVP language from implementation planning and explicitly mark local/demo shortcuts as forbidden in production paths.

**Completion test:**

- Architecture document exists and names all production services.
- ADRs exist for the key stack decisions.
- The document states that ChatGPT/Codex private UI scraping is forbidden.
- The plan separates web app, worker, database, queue, object storage, AI, and integrations.

### Stage 02 — Repository and Project Foundation

**Goal:** create a maintainable application foundation for a large production system.

**Implementation prompt:**  
Initialize the production codebase using Next.js App Router and TypeScript strict mode. Configure linting, formatting, import aliases, environment typing, route groups, app layout, shared UI structure, server-only modules, and test directories. Add clear module boundaries for `app`, `components`, `lib`, `server`, `services`, `workers`, `integrations`, `ai`, `db`, and `tests`.

**Completion test:**

- `npm run typecheck` passes.
- `npm run lint` passes.
- The app starts locally without runtime errors.
- Server-only modules are not imported into client components.

### Stage 03 — Environment Contract and Configuration Layer

**Goal:** make all runtime configuration typed, validated, and environment-aware.

**Implementation prompt:**  
Implement a typed environment configuration layer using Zod. Define required variables for database, Redis, object storage, NextAuth/Auth.js, Stripe, OpenAI, GitHub App, webhooks, encryption keys, public app URL, worker URL, and logging. Add separate examples for local, staging, and production. Fail fast on invalid server config and expose only safe public config to the client.

**Completion test:**

- App fails with a clear error when required server env vars are missing.
- Public client bundle does not expose server secrets.
- `.env.example` documents all required variables.
- Unit tests cover valid and invalid config.

### Stage 04 — CI/CD Quality Gates

**Goal:** prevent broken or unsafe code from reaching production.

**Implementation prompt:**  
Create CI workflows for install, typecheck, lint, unit tests, integration tests, Prisma validation, secret scan, dependency audit, and build. Add branch protection expectations and separate workflows for preview, staging, and production. Ensure production deployment requires passing checks and explicit environment promotion.

**Completion test:**

- CI runs on pull requests.
- Typecheck, lint, tests, Prisma validation, and secret scan are required.
- Production deployment cannot run from an unchecked branch.
- CI artifacts include test and build results.

### Stage 05 — Database Schema Foundation

**Goal:** implement the production data model with migrations from day one.

**Implementation prompt:**  
Create Prisma schema for users, organizations, memberships, projects, source documents, source files, source connections, normalized sources, redaction reports, extraction runs, extraction facts, story runs, story artifacts, editor revisions, jobs, usage events, audit logs, integration accounts, GitHub installations, billing accounts, and webhook deliveries. Add indexes for `orgId`, `projectId`, status fields, timestamps, source type, and external IDs.

**Completion test:**

- Prisma migration applies to an empty PostgreSQL database.
- Prisma schema validates successfully.
- Indexes exist for high-traffic query paths.
- A seed script can create an org, user, project, and sample source.

### Stage 06 — Database Access Layer

**Goal:** keep database access out of UI and route handlers.

**Implementation prompt:**  
Build a database access layer with scoped service functions. Route handlers must call services, not Prisma directly. Enforce `orgId` and `userId` scoping in query helpers. Add transaction helpers for multi-step operations such as source creation, extraction completion, artifact revision, and billing event reconciliation.

**Completion test:**

- Static search shows no Prisma imports in client components.
- Route handlers use services instead of raw Prisma calls.
- Unit tests verify that cross-org access returns no data.
- Transaction tests cover rollback on failure.

### Stage 07 — NextAuth Authentication Integration

**Goal:** implement production user identity, sessions, and organization mapping.

**Implementation prompt:**  
Integrate NextAuth/Auth.js authentication with Next.js proxy protection. Mirror authenticated users into the local database, keep organizations and memberships owned by Storro, and store local `userId`, `orgId`, membership role, and billing customer reference. Add authenticated layout handling, sign-in, sign-out, organization switcher, and session-aware API helpers.

**Completion test:**

- Unauthenticated users are redirected from protected routes.
- NextAuth sign-in/session resolution creates or updates local users and resolves local organization context.
- API requests include a resolved local user and org context.
- Organization switching changes scoped project visibility.

### Stage 08 — Authorization and RBAC

**Goal:** protect every organization and project resource.

**Implementation prompt:**  
Implement RBAC for owner, admin, editor, and viewer roles. Add authorization guards for projects, sources, extractions, artifacts, integrations, billing, and admin actions. Enforce authorization in service functions, not only in UI. Add audit entries for permission-sensitive actions.

**Completion test:**

- Viewer cannot mutate project data.
- Editor cannot change billing or integrations requiring admin rights.
- Cross-org API requests return `403` or `404`.
- Authorization tests cover every protected service category.

### Stage 09 — API Architecture and Error Contract

**Goal:** standardize API behavior before feature routes multiply.

**Implementation prompt:**  
Build a route handler pattern with Zod request validation, typed responses, consistent error codes, request IDs, structured logs, and service-level error mapping. Define common responses for validation errors, auth errors, permission errors, rate limits, integration failures, AI failures, and job status polling.

**Completion test:**

- Invalid payloads return structured validation errors.
- API responses include request IDs.
- Route handler tests cover success, validation failure, unauthorized, forbidden, and internal error.
- UI can render user-friendly API errors.

### Stage 10 — Design System and Shell UI

**Goal:** create a polished production UI foundation.

**Implementation prompt:**  
Implement the Storro application shell with dashboard navigation, project navigation, integrations, billing, settings, editor, and job status surfaces. Configure Tailwind tokens, shadcn/ui components, empty states, loading states, error states, command actions, responsive layout, and accessible focus behavior. Keep visual language premium, editorial, and developer-focused.

**Completion test:**

- App shell renders correctly on desktop and mobile widths.
- Keyboard navigation reaches primary controls.
- Loading and error states exist for main layouts.
- Visual regression screenshots show no text overlap.

### Stage 11 — Project Workspace Domain

**Goal:** support real customer project organization.

**Implementation prompt:**  
Implement project creation, editing, archiving, listing, search, tags, visibility status, project metadata, and project-level settings. Add project dashboard summary cards for sources, extractions, artifacts, integrations, recent jobs, and usage.

**Completion test:**

- User can create, edit, archive, and restore a project.
- Archived projects are hidden by default but recoverable.
- Project queries are scoped to the active organization.
- E2E test covers project creation to project detail page.

### Stage 12 — Source Document CRUD

**Goal:** make source material a first-class object before AI processing.

**Implementation prompt:**  
Implement source document creation, listing, detail view, editing metadata, soft deletion, source type classification, tags, timestamps, private/public flags, and source selection. Store raw source metadata separately from normalized content. Add source provenance fields for manual input, file upload, GitHub, ChatGPT export, Codex note, CLI, MCP, and webhook.

**Completion test:**

- User can add, view, edit metadata, and delete a source.
- Source list filters by type, tag, privacy, and date.
- Deleted sources are excluded from extraction.
- Service tests verify provenance fields.

### Stage 13 — Production File Upload Service

**Goal:** support secure file ingestion through object storage.

**Implementation prompt:**  
Implement direct or server-mediated uploads to S3/R2-compatible storage. Add file size limits, MIME/type validation, extension validation, virus scanning hook interface, checksum calculation, object key convention, metadata persistence, signed download URLs, and safe deletion. Uploaded files must never be sent to AI before parsing, filtering, and redaction.

**Completion test:**

- Allowed `.txt`, `.md`, `.json`, and safe archive files upload successfully.
- Unsupported files are rejected with clear errors.
- Uploaded object metadata is stored in PostgreSQL.
- Signed URLs expire and cannot expose unrelated files.

### Stage 14 — Source Parser Framework

**Goal:** make source parsing extensible and testable.

**Implementation prompt:**  
Create a parser registry keyed by source type and file type. Implement a common parser result format with extracted text, metadata, warnings, detected sections, source timestamps, and parse confidence. Add parser isolation so a failed parser does not corrupt the source record. Persist parser output and warnings.

**Completion test:**

- Parser registry selects correct parser by source type and extension.
- Unsupported source type returns a controlled error.
- Parser warnings are visible in source detail.
- Unit tests cover successful parse and parser failure.

### Stage 15 — ChatGPT Export Import

**Goal:** ingest official ChatGPT exports without hidden access.

**Implementation prompt:**  
Implement parser support for official ChatGPT export `conversations.json`. Parse conversations defensively, preserve titles, roles, timestamps, messages, and source IDs. Add a conversation/message selector UI so users explicitly choose what to import. Store selected messages as source documents with ChatGPT export provenance.

**Completion test:**

- Valid `conversations.json` parses into selectable conversations.
- User can import selected conversations only.
- Malformed export returns warnings without crashing.
- Imported sources preserve role, message order, and timestamps.

### Stage 16 — Manual Notes and Daily Build Journal Input

**Goal:** let users add high-signal human context.

**Implementation prompt:**  
Build manual source entry for research notes, build notes, daily journal notes, failed attempts, lessons, and public/private comments. Add structured fields for what was tried, what worked, what failed, files touched, next step, and public-safe summary. Give manual notes higher ranking in extraction.

**Completion test:**

- User can create a structured daily build note.
- Private fields are marked private by default.
- Manual notes appear at the top of source selection.
- Extraction ranking tests prioritize manual notes.

### Stage 17 — Git Diff and Commit Text Parser

**Goal:** support local repository evidence even before GitHub sync.

**Implementation prompt:**  
Implement parsers for pasted `git diff`, `git show`, `git log`, and diff stats. Detect file paths, additions/deletions, commit SHAs, commit messages, branches, binary files, generated files, lock files, and tests. Collapse ignored file classes and produce normalized change summaries.

**Completion test:**

- Parser extracts changed files from sample diffs.
- Lock files and generated files are collapsed.
- Binary patches are ignored safely.
- Unit tests cover diff, commit log, and malformed input.

### Stage 18 — Redaction Engine

**Goal:** prevent secrets from entering AI or public artifacts.

**Implementation prompt:**  
Implement a redaction engine that scans raw and parsed sources for OpenAI keys, GitHub tokens, JWTs, private keys, database URLs, seed phrases, OAuth secrets, webhook secrets, and generic secret assignments. Produce redacted text, findings, severity, blocked status, and user review requirements. Store redaction reports and ensure AI jobs use only redacted content.

**Completion test:**

- Fake secrets are detected and redacted.
- Private keys and seed phrases block AI processing by default.
- Redaction report is visible to the user.
- Tests prove AI input receives redacted text, not raw text.

### Stage 19 — Source Normalization Service

**Goal:** convert every source type into a shared internal format.

**Implementation prompt:**  
Build a normalization service that converts manual notes, ChatGPT exports, git diffs, commit logs, GitHub commits, PRs, releases, Codex notes, CLI snapshots, and MCP notes into `NormalizedSource` records. Include source IDs, project ID, source type, title, body, metadata, timestamps, privacy flags, ranking score, and provenance.

**Completion test:**

- Every supported source type creates a normalized record.
- Normalized records keep links to raw source documents.
- Privacy and provenance survive normalization.
- Snapshot tests verify normalized shape.

### Stage 20 — Chunking and Source Ranking

**Goal:** handle large sources without wasting model context.

**Implementation prompt:**  
Implement source ranking and chunking. Rank manual notes, PR title/body, commit messages, diff stats, important source files, tests, and configs before full patches. Chunk large text by source type, file path, and semantic boundaries. Persist chunk summaries and token estimates. Exclude ignored folders and oversized generated artifacts.

**Completion test:**

- Large diff is split into stable chunks.
- Ranking puts manual notes and PR body before raw patches.
- Ignored files are excluded or collapsed.
- Unit tests cover token budget limits.

### Stage 21 — AI Gateway and Model Routing

**Goal:** centralize AI calls, retries, cost tracking, and model policy.

**Implementation prompt:**  
Implement an AI gateway around the OpenAI Responses API. Add model routing for extraction, planning, generation, grounding, and summarization. Add request validation, retries with backoff, timeout handling, usage tracking, prompt versioning, structured output parsing, and provider abstraction for future model changes.

**Completion test:**

- AI calls go only through the gateway.
- Usage events are recorded for each successful call.
- Timeout and retry behavior is tested with mocked responses.
- Structured output parse failures become controlled job errors.

### Stage 22 — Structured Extraction Pipeline

**Goal:** turn redacted sources into traceable build facts.

**Implementation prompt:**  
Implement async extraction jobs. The pipeline must load selected normalized sources, use redacted chunks, call structured extraction, validate output with Zod, store extraction facts, timeline events, missing context, risk flags, confidence scores, privacy flags, and source references. Support partial retry for failed chunks.

**Completion test:**

- Extraction job creates facts with `sourceIds`.
- Invalid model output is rejected and logged.
- Failed chunks can retry without duplicating successful facts.
- Integration test runs extraction with mocked AI output.

### Stage 23 — Extraction Review Board

**Goal:** let users control facts before generation.

**Implementation prompt:**  
Build a review UI for extracted facts. Users can approve, edit, reject, mark private, add missing facts, adjust confidence, and inspect source references. Add filters by category, source, privacy, confidence, and risk. Persist review state and require approved facts for public generation.

**Completion test:**

- User can approve, edit, reject, and mark facts private.
- Rejected facts are excluded from generation.
- Source reference opens the original source context.
- E2E test covers extraction review to approved state.

### Stage 24 — Story Planning Engine

**Goal:** create an outline before writing final artifacts.

**Implementation prompt:**  
Implement story plan generation from approved extraction facts. Generate title options, hook, audience, thesis, sections, facts to use, claims to avoid, next step, and template-specific constraints. Store story plan versions and expose the plan for user review and regeneration.

**Completion test:**

- Story plan references only approved facts.
- Claims-to-avoid include missing or risky context.
- User can regenerate a plan without deleting the previous version.
- Tests verify private facts are excluded from public plans unless approved.

### Stage 25 — Template System

**Goal:** support multiple commercial output formats cleanly.

**Implementation prompt:**  
Implement a template registry for long article, DoraHacks update, GitHub release notes, LinkedIn post, Twitter/X thread, daily build journal, investor update, internal changelog, and custom organization templates. Each template must define audience, tone, required sections, length limits, private fact policy, and grounding rules.

**Completion test:**

- Template registry returns typed template definitions.
- Unsupported template IDs fail safely.
- Each template has tests for required fields.
- UI lists available templates based on plan and subscription.

### Stage 26 — Artifact Generation Engine

**Goal:** generate polished markdown artifacts from approved plans.

**Implementation prompt:**  
Implement async artifact generation jobs. Use approved story plan and template definition. Generate markdown only, avoid unsupported claims, include concrete implementation details, preserve uncertainty, and store artifact metadata including model, prompt version, input fact IDs, and generation status.

**Completion test:**

- Artifact is created from a story plan and template.
- Artifact metadata includes model, prompt version, and fact IDs.
- Private facts are excluded from public templates.
- Mocked AI integration test verifies successful generation.

### Stage 27 — Grounding and Safety Review

**Goal:** verify generated artifacts before export.

**Implementation prompt:**  
Implement a grounding review job that compares generated markdown against approved facts and template policy. Detect unsupported claims, invented metrics, invented integrations, sensitive leaks, generic AI phrases, overclaiming, and missing required sections. Auto-revise minor issues and block severe issues for user review.

**Completion test:**

- Fake unsupported claim is detected.
- Fake secret in output blocks export.
- Generic phrase checks produce quality warnings.
- Artifact cannot be exported when severe grounding review fails.

### Stage 28 — Markdown Editor and Revision History

**Goal:** let users refine artifacts without losing provenance.

**Implementation prompt:**  
Build a markdown editor with preview, autosave, manual save, revision history, diff view, restore revision, source/fact sidebar, grounding warnings, export readiness status, and editor metadata. Store every saved revision with author, timestamp, content hash, and grounding state.

**Completion test:**

- Autosave creates revisions.
- User can restore an older revision.
- Preview renders markdown and GFM tables.
- Revision diff shows changes between versions.

### Stage 29 — Export and Publishing System

**Goal:** let users reuse generated artifacts across channels.

**Implementation prompt:**  
Implement export to markdown, plain text, PDF-ready HTML, release notes, clipboard copy, and downloadable files in object storage. Add export records, export permissions, export status, and optional publishing adapters. Export must use the latest passed grounding review or require explicit override with audit log.

**Completion test:**

- User can download markdown and plain text exports.
- Export record is stored with artifact revision ID.
- Failed grounding blocks export unless override is permitted.
- Download URLs are scoped and expire.

### Stage 30 — GitHub App Installation Flow

**Goal:** implement production GitHub integration through GitHub Apps.

**Implementation prompt:**  
Create GitHub App connection flow. Support installation callback, installation ID storage, repository selection, org/project mapping, permission display, installation token generation, token refresh on demand, and disconnect behavior. Do not store long-lived personal access tokens as the production path.

**Completion test:**

- User can connect a GitHub App installation.
- Selected repositories map to Storro projects.
- Installation token is generated on demand.
- Disconnect removes access and marks sources as historical.

### Stage 31 — GitHub Repository Import

**Goal:** ingest repository metadata and commit history.

**Implementation prompt:**  
Implement GitHub repository import using installation tokens. Import repository metadata, branches, recent commits, commit details, changed files, diff stats, authors, timestamps, and commit URLs. Normalize imported commits into source documents and normalized sources. Handle rate limits and permission errors gracefully.

**Completion test:**

- Connected repository imports metadata and commits.
- Imported commits are visible as sources.
- Rate limit response creates a recoverable integration error.
- Service tests mock Octokit responses.

### Stage 32 — GitHub Pull Request Import

**Goal:** ingest PR context as high-quality story evidence.

**Implementation prompt:**  
Implement PR import for title, body, state, labels, reviewers, changed files, commits, comments summary, checks summary, merge status, and URL. Normalize PR body and changed files as prioritized source context. Add UI for selecting PRs by repository, branch, date, and status.

**Completion test:**

- User can import selected PR context.
- PR body and file list become normalized sources.
- Closed, merged, and open statuses are preserved.
- Tests verify selected PR import does not import all PRs.

### Stage 33 — GitHub Webhook Processing

**Goal:** keep repository context updated safely.

**Implementation prompt:**  
Implement verified GitHub webhooks for `push`, `pull_request`, `release`, `issues`, and `workflow_run`. Verify `X-Hub-Signature-256`, persist webhook delivery records, enforce idempotency, enqueue processing jobs, map events to installations/projects, and surface integration status in the UI.

**Completion test:**

- Unsigned or invalid webhook is rejected.
- Duplicate delivery does not create duplicate records.
- Valid PR webhook enqueues a processing job.
- Webhook replay test can process stored payloads.

### Stage 34 — Optional GitHub Write Features

**Goal:** add commercial publishing features with explicit permissions.

**Implementation prompt:**  
Implement optional write-enabled GitHub features behind separate permission checks: create release note draft, open PR comment with generated summary, create/update changelog file, and publish release draft. Require explicit user action, permission explanation, audit log, and dry-run preview before writing to GitHub.

**Completion test:**

- Write features are hidden without write permissions.
- Dry run shows exact GitHub action before execution.
- User confirmation is required.
- Audit log records every external write.

### Stage 35 — Codex Evidence Through GitHub

**Goal:** model Codex-assisted work through repository evidence.

**Implementation prompt:**  
Implement Codex evidence classification for commits, PRs, branches, generated summaries, and optional user notes. Add source type labels for Codex-assisted work without claiming hidden Codex access. Allow users to mark a PR or commit range as Codex-assisted and add a short summary of prompts, decisions, and fixes.

**Completion test:**

- User can mark imported GitHub context as Codex-assisted.
- UI explains that evidence comes from repository data and notes.
- Extraction facts preserve Codex source provenance.
- Tests verify no claim of automatic private Codex access.

### Stage 36 — Codex GitHub Action Artifact Ingestion

**Goal:** receive structured PR context from CI.

**Implementation prompt:**  
Create a Storro GitHub Action ingestion endpoint and example workflow. The action should collect diff stat, full diff where allowed, test results, changed files, dependency changes, migration summary, and a short CI context file. Authenticate with a scoped ingest token or GitHub OIDC flow. Store action artifacts as source documents.

**Completion test:**

- Endpoint rejects invalid ingest tokens.
- Valid action payload creates source documents.
- Large diff artifacts are stored in object storage.
- Sample GitHub Action workflow is documented and testable.

### Stage 37 — Local Snapshot CLI

**Goal:** capture local work without scraping tools.

**Implementation prompt:**  
Build `storro snapshot` CLI. It should collect `git status --short`, `git diff --stat`, optional full diff, staged diff, recent commits, branch info, package changes, and a required user note. Send data to Storro through an authenticated API token. Add config for project mapping and privacy controls.

**Completion test:**

- CLI creates a snapshot source in Storro.
- CLI refuses to send full diff when secrets are detected locally.
- Project mapping persists in local config.
- CLI tests mock git command output and API calls.

### Stage 38 — MCP Server Foundation

**Goal:** expose Storro capabilities to official AI app integrations.

**Implementation prompt:**  
Implement a Storro MCP server with authenticated tools for creating projects, listing projects, ingesting research notes, ingesting build notes, generating stories, retrieving artifacts, and saving revisions. Enforce user authorization, input schemas, rate limits, audit logs, and explicit user context boundaries.

**Completion test:**

- MCP tools validate inputs and auth.
- Tool calls create normal Storro source records.
- Unauthorized tool calls fail.
- Contract tests cover every MCP tool schema.

### Stage 39 — ChatGPT App Integration

**Goal:** support official ChatGPT-to-Storro workflows.

**Implementation prompt:**  
Build ChatGPT App integration using Apps SDK and the Storro MCP server. Implement OAuth connection, selected-note ingestion, project selection, story generation from explicit context, artifact retrieval, and save draft workflows. The app must never assume access to all ChatGPT history.

**Completion test:**

- ChatGPT App can authenticate a Storro user.
- User-selected context creates Storro sources.
- Generated story appears in Storro artifact list.
- Tests and docs state no hidden conversation access.

### Stage 40 — Integration Settings and Health UI

**Goal:** give users transparent control over integrations.

**Implementation prompt:**  
Build `/settings/integrations` for GitHub, ChatGPT App, Codex Action, CLI, OpenAI usage, object storage status, and webhooks. Show connection state, permissions, last sync, last error, sync controls, disconnect controls, and audit history. Add project-level integration mapping.

**Completion test:**

- Connected and disconnected states render correctly.
- User can resync or disconnect GitHub.
- Last webhook and last sync status are visible.
- Integration errors include actionable copy.

### Stage 41 — Search, Memory, and Retrieval

**Goal:** make stored project memory reusable.

**Implementation prompt:**  
Implement project memory search with PostgreSQL full-text search and optional embeddings through pgvector. Index source documents, normalized sources, extraction facts, story plans, and artifacts. Add filters by project, source type, date, tag, privacy, and confidence. Use retrieval only on authorized project data.

**Completion test:**

- Search returns relevant project sources and artifacts.
- Cross-org search returns no data.
- Private facts are filtered from public generation retrieval.
- Search index updates after source and artifact changes.

### Stage 42 — Timeline and Daily Build Journal

**Goal:** turn source activity into a durable project history.

**Implementation prompt:**  
Build project timeline combining manual notes, GitHub commits, PRs, extraction events, story artifacts, releases, and integration events. Add daily/weekly views, private journal mode, public update mode, date range selection, and timeline-based story generation.

**Completion test:**

- Timeline groups events by day.
- User can filter by source type and privacy.
- Date range generation uses only selected timeline events.
- E2E test covers daily journal to generated artifact.

### Stage 43 — Notifications and Email

**Goal:** support operational product workflows.

**Implementation prompt:**  
Implement notification system for extraction complete, generation complete, grounding failed, GitHub sync failed, webhook disconnected, quota warning, billing issue, and export ready. Support in-app notifications first and email through a provider abstraction. Add user preferences and organization-level defaults.

**Completion test:**

- In-app notification appears after job completion.
- User can disable non-critical email notifications.
- Critical billing and integration errors still appear in-app.
- Notification tests verify deduplication.

### Stage 44 — Stripe Billing, Plans, and Quotas

**Goal:** commercialize the product safely.

**Implementation prompt:**  
Implement Stripe Billing with free trial, pro, team, and enterprise-ready plan structure. Add checkout, customer portal, subscription sync, invoice status, payment failure handling, usage events, quotas for projects, sources, AI runs, exports, storage, and team seats. Enforce quotas server-side.

**Completion test:**

- Checkout creates subscription and local billing record.
- Stripe webhook updates subscription status idempotently.
- Quota-limited action is blocked server-side.
- Billing tests replay webhook fixtures.

### Stage 45 — Admin and Support Console

**Goal:** operate a commercial product without direct database access.

**Implementation prompt:**  
Build an internal admin console for authorized staff. Include organization lookup, user lookup, subscription status, integration health, job history, webhook deliveries, audit logs, usage events, and support-safe source metadata. Do not expose raw sensitive source content by default.

**Completion test:**

- Non-admin users cannot access admin routes.
- Admin can inspect job and integration status.
- Raw source content is hidden unless privileged access is explicitly granted.
- Admin actions are audit logged.

### Stage 46 — Security Hardening

**Goal:** protect user data, secrets, and integrations.

**Implementation prompt:**  
Implement encryption for stored integration tokens, strict CSP, secure cookies, CSRF protection where applicable, rate limiting, request body limits, webhook signature validation, signed URLs, audit logs, dependency scanning, secret scanning, data retention policies, and organization-level data export/deletion workflow.

**Completion test:**

- Tokens are encrypted at rest.
- Rate limits block abusive API calls.
- Security headers are present.
- Data deletion removes or anonymizes organization data according to policy.

### Stage 47 — Observability and Incident Readiness

**Goal:** make production behavior visible and debuggable.

**Implementation prompt:**  
Integrate Sentry, OpenTelemetry traces, structured logs, metrics, job duration tracking, AI usage tracking, GitHub sync metrics, webhook delivery metrics, queue depth, error rates, and alert thresholds. Add runbooks for AI failures, GitHub webhook failures, queue backlog, database issues, and billing webhook failures.

**Completion test:**

- Errors appear in Sentry with request ID.
- Job traces include queue wait time and processing duration.
- Metrics dashboard shows API errors, queue depth, and AI usage.
- Runbooks exist for critical failure modes.

### Stage 48 — Test Suite and AI Evaluation Harness

**Goal:** verify core quality before launch.

**Implementation prompt:**  
Build a layered test suite: unit tests for parsers, redaction, normalization, authorization, billing, and templates; integration tests for API routes, jobs, GitHub import, Stripe webhooks, and AI gateway; E2E tests for project-to-artifact flow; AI evaluation tests for hallucination, sensitive leaks, generic phrasing, and source grounding.

**Completion test:**

- Targeted unit and integration tests pass in CI.
- E2E happy path creates a project, imports sources, extracts facts, generates artifact, and exports markdown.
- AI eval fails on invented claims and fake secrets.
- Coverage report identifies untested critical services.

### Stage 49 — Production Deployment and Infrastructure

**Goal:** deploy the full system with safe promotion.

**Implementation prompt:**  
Create production deployment setup for web app, worker service, PostgreSQL, Redis, object storage, environment secrets, migrations, health checks, deployment previews, staging, production, rollback plan, backup policy, and disaster recovery. Ensure workers and web share the same typed config but can scale independently.

**Completion test:**

- Staging deployment runs web, worker, database, Redis, and storage.
- Health checks verify database, Redis, storage, and queue connectivity.
- Migrations run safely during deployment.
- Rollback and backup restore procedure are documented and tested.

### Stage 50 — Launch Readiness, Performance, and Compliance

**Goal:** verify the product is ready for commercial users.

**Implementation prompt:**  
Run production readiness work: load tests for source import and AI job queues, performance budgets for dashboard/editor, accessibility checks, privacy policy and terms hooks, data retention controls, support workflow, onboarding checklist, pricing gate validation, final security review, and launch monitoring dashboard.

**Completion test:**

- Load test meets agreed queue and API latency targets.
- Core pages pass accessibility checks.
- Privacy, retention, and deletion flows are implemented.
- Launch checklist is complete with no critical blockers.

## Recommended Build Order

Use the stages in numeric order. Do not start AI generation before source storage, normalization, redaction, async jobs, and authorization are in place. Do not start ChatGPT/Codex advanced integrations before GitHub App, source provenance, and audit logging are stable.

## Production Definition of Done

A production stage is complete only when:

- implementation is merged through CI;
- database migrations are committed and reversible where possible;
- service-level authorization is tested;
- user-facing errors are handled;
- observability exists for new jobs or external calls;
- sensitive data handling is reviewed;
- at least one targeted automated test proves the main path;
- documentation for operation or integration is updated when relevant.
