# Support Workflow

## Intake

1. Confirm organization and user identity.
2. Use admin console for subscription, integration, job, webhook, audit, and usage state.
3. Do not request raw source content by default.

## Privileged Source Access

Raw source preview requires:

- explicit support reason;
- admin access;
- `admin.raw_source_access` audit event.

## Escalation

- Billing: verify Stripe event ID and local billing state.
- GitHub: verify installation status, permissions, and webhook deliveries.
- AI: verify extraction/generation job trace and Sentry request ID.
