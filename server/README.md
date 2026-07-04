# Server Module

Server-only request helpers, auth context, typed configuration, logging, and observability live here.

## API Contract

New route handlers should use `server/api/route-handler.ts` so every API response has:

- `{ ok, requestId, data }` or `{ ok, requestId, error }` JSON envelopes.
- `x-request-id` response headers.
- Zod body/query validation before service calls.
- Structured request logs with status, duration, and error code.
- Service error mapping for auth, permissions, rate limits, integrations, AI failures, and job polling.
