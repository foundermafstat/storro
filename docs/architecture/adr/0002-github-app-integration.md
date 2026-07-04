# ADR 0002: Use a GitHub App for Repository Integration

## Status

Accepted

## Decision

Use a GitHub App as the production repository integration. Default permissions are read-only. Optional write permissions are requested separately for explicit publishing features.

## Rationale

GitHub Apps provide repository-scoped installation, fine-grained permissions, webhooks, and short-lived installation tokens. This is safer than long-lived personal access tokens for a commercial product.

## Consequences

- Store installation IDs and selected repositories.
- Generate installation tokens on demand.
- Verify all GitHub webhooks with `X-Hub-Signature-256`.
- External write actions require permission explanation, preview, confirmation, and audit log.
