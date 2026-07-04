# ADR 0006: Separate Web and Worker Runtimes

## Status

Accepted

## Decision

Deploy the Next.js web app separately from the worker service. Both runtimes share typed configuration and domain packages, but scale independently.

## Rationale

Web traffic and job processing have different scaling, timeout, and reliability profiles. Separating runtimes avoids blocking user requests with parsing, AI, export, webhook, or billing work.

## Consequences

- Production deploys include web, worker, PostgreSQL, Redis, object storage, and monitoring.
- Workers require health checks, queue metrics, and runbooks.
- Database migrations run before worker rollout.
- Rollbacks must account for both web and worker versions.
