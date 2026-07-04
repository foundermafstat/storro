# ADR 0001: Use Clerk for Production Authentication

## Status

Accepted

## Decision

Use Clerk for user identity, sessions, organizations, MFA, SSO path, and auth UI primitives. Mirror Clerk users, organizations, and memberships into PostgreSQL through verified webhooks.

## Rationale

Storro needs commercial organization accounts, team seats, session security, and a fast enterprise path. Clerk provides these identity primitives while Storro keeps product authorization in its own service layer.

## Consequences

- API handlers resolve Clerk identity before calling services.
- Local database records store `userId`, `orgId`, membership role, and billing references.
- Clerk webhooks must be signature-verified and idempotent.
- Service-level RBAC remains mandatory.
