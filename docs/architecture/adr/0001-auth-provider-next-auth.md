# ADR 0001: Use NextAuth/Auth.js for Production Authentication

## Status

Accepted

## Decision

Use NextAuth/Auth.js for user authentication and session management. Storro owns organizations, memberships, roles, billing account references, and authorization rules in PostgreSQL.

## Rationale

Storro needs flexible OAuth-based authentication without outsourcing core organization and RBAC semantics. NextAuth/Auth.js fits the Next.js App Router runtime and lets the product keep commercial workspace logic inside the Storro domain model.

## Consequences

- API handlers and server components resolve sessions through the shared `auth.ts` entrypoint.
- NextAuth users are mirrored into local `User` records through `authUserId`.
- Organizations and memberships are Storro-owned resources, not external identity-provider organizations.
- Service-level RBAC remains mandatory for all protected resources.
