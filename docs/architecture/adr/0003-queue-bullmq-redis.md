# ADR 0003: Use BullMQ and Redis for Production Jobs

## Status

Accepted

## Decision

Use Redis and BullMQ for ingestion, parsing, redaction, extraction, generation, grounding, exports, webhook processing, sync jobs, and billing reconciliation.

## Rationale

Storro workflows involve external APIs, model calls, large files, retries, status tracking, and rate limits. These flows should not run inside request/response paths.

## Consequences

- API routes enqueue jobs and return job IDs.
- Workers process jobs independently from the web app.
- Job payloads must be scoped, validated, idempotent, retryable, and observable.
- Queue metrics are part of production monitoring.
