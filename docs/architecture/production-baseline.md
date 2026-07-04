# Storro Production Architecture Baseline

## Scope

Storro is a commercial developer memory and publishing platform. The production system is built around explicit source ingestion, durable project memory, secure async AI processing, reviewed artifacts, paid usage controls, and auditable integrations.

## Production Runtime Topology

```text
Browser
  -> Next.js web app
  -> Next.js API route handlers
  -> service layer
  -> PostgreSQL
  -> Redis / BullMQ queue
  -> worker service
  -> S3/R2 object storage
  -> OpenAI Responses API
  -> GitHub App API
  -> Stripe Billing API
  -> NextAuth/Auth.js session layer
  -> Storro MCP server
```

## Service Boundaries

- **Web app:** App Router pages, React UI, authenticated layouts, editor, dashboards, and settings.
- **API layer:** request validation, auth context, response envelope, route-to-service delegation.
- **Service layer:** resource authorization, transactions, domain workflows, audit events.
- **Worker service:** ingestion, parsing, redaction, extraction, story planning, generation, grounding, exports, webhook processing.
- **Database:** PostgreSQL is the system of record for users, organizations, projects, sources, facts, artifacts, billing state, jobs, audit logs, and integration state.
- **Queue:** Redis and BullMQ run all long-running or external-call workflows.
- **Object storage:** S3/R2 stores uploaded files, large source payloads, generated exports, and job artifacts.
- **AI gateway:** all model calls go through one typed gateway with prompt versions, structured output validation, usage tracking, retries, and audit metadata.
- **Integration layer:** GitHub App, Stripe, NextAuth/Auth.js, ChatGPT App through MCP, Codex evidence through GitHub, CI artifacts, CLI snapshots, and future plugin paths.

## Environment Tiers

- **Development:** local app, local or managed PostgreSQL, local Redis, sandbox integrations, test object bucket.
- **Staging:** production-like services, isolated secrets, test Stripe mode, GitHub test app, restricted test users.
- **Production:** managed PostgreSQL, managed Redis, durable object storage, production NextAuth/Auth.js, production Stripe, production GitHub App, alerting, backups, and incident runbooks.

## Data Ownership Rules

- Every customer-owned record is scoped by `orgId`.
- Project records are scoped by both `orgId` and `projectId`.
- User identity is resolved through NextAuth/Auth.js and mirrored into local Storro users; authorization is enforced by Storro service guards.
- Source documents keep provenance, privacy flags, redaction state, and source references.
- Generated artifacts must keep links to the approved extraction facts and source IDs used to create them.
- Integration tokens are encrypted at rest or generated on demand.

## Integration Principles

- ChatGPT and Codex private UI scraping is forbidden.
- ChatGPT context enters only through paste, official export, explicit ChatGPT App/MCP tool calls, or future approved connectors.
- Codex context enters through repository evidence, user notes, GitHub Action artifacts, CLI snapshots, or future plugin/MCP workflows.
- GitHub context enters through a GitHub App with explicit installation, scoped repositories, short-lived installation tokens, and verified webhooks.
- Any external write action requires separate permission, user confirmation, dry-run preview, and audit log.

## Async Processing Policy

- Source parsing, redaction, extraction, story planning, generation, grounding, exports, webhook processing, sync jobs, and billing reconciliation run through BullMQ workers.
- API routes enqueue jobs and return job IDs for polling or notification.
- Jobs must be idempotent, retryable, scoped to organization/project, and observable.
- Worker failures must not destroy user source data.

## Security Constraints

- No raw secrets are sent to AI providers.
- Redaction and file filtering must run before extraction or generation.
- Cross-organization data access must fail in service code, not just UI.
- Webhooks require signature verification and idempotency.
- Rate limits protect public APIs, integration endpoints, MCP tools, and expensive AI operations.
- Audit logs record permission-sensitive actions, external writes, billing changes, token changes, and admin access.

## Module Map

- `app/` - App Router pages and route handlers.
- `components/` - reusable UI components.
- `lib/` - shared pure utilities and client-safe helpers.
- `server/` - server-only auth, config, logging, and request helpers.
- `services/` - domain services and authorization-aware workflows.
- `db/` - Prisma client, schema, seed, migrations, scoped query helpers.
- `workers/` - BullMQ queues, processors, schedulers, and job contracts.
- `integrations/` - GitHub, NextAuth/Auth.js, Stripe, object storage, MCP, and CLI integration code.
- `ai/` - AI gateway, prompts, schemas, model routing, grounding, and evaluations.
- `tests/` - unit, integration, contract, E2E, webhook replay, and AI evaluation tests.

## Production Definition

A feature is production-ready only when it has service-level authorization, typed validation, durable persistence, async job handling for expensive work, observability, user-facing error states, targeted automated tests, and documented operational behavior.
