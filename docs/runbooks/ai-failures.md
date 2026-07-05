# AI Failures Runbook

## Detect
- Alert: `aiFailureCount >= 5` in 15 minutes.
- Check `/api/observability/metrics` for `AI_EXTRACTION` and `AI_GENERATION` usage gaps.
- Inspect failed `EXTRACTION`, `STORY_PLAN`, `STORY_GENERATION`, and `GROUNDING_REVIEW` jobs.

## Triage
- Confirm OpenAI API key, model names, and provider status.
- Compare request IDs from API errors with Sentry events.
- Verify redaction did not block all source text.

## Mitigate
- Retry retryable jobs after provider recovery.
- Temporarily reduce concurrency for AI queues.
- Switch model env values only through production config change control.

## Follow-Up
- Add failing prompt payload shape to tests.
- Record incident timeline and affected organizations.
