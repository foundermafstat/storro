# ADR 0004: Use S3/R2-Compatible Object Storage

## Status

Accepted

## Decision

Use S3/R2-compatible object storage for uploaded source files, large raw payloads, generated exports, and job artifacts.

## Rationale

Source exports, diffs, artifacts, and downloads can exceed practical database row sizes. Object storage provides durable, scalable storage with signed URL access and lifecycle policies.

## Consequences

- PostgreSQL stores object metadata and ownership.
- Objects are addressed by organization-scoped keys.
- Downloads use short-lived signed URLs.
- Deletion and retention policies must delete both database records and objects.
