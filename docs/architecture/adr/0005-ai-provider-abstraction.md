# ADR 0005: Use an Internal AI Gateway

## Status

Accepted

## Decision

Route all OpenAI Responses API calls through an internal AI gateway. The gateway owns model routing, prompt versions, structured output validation, retries, timeouts, usage accounting, and safety metadata.

## Rationale

Storro must prevent untracked model calls, control cost, support schema validation, and preserve source-grounding metadata. A gateway also keeps future model changes localized.

## Consequences

- Application code cannot call OpenAI directly.
- Prompt versions are stored with extraction and artifact records.
- Usage events are recorded for billing and observability.
- Redaction must complete before AI gateway calls.
