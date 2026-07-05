# Database Issues Runbook

## Detect
- Alert: API 5xx error rate exceeds 5% with database-related errors.
- Check Sentry events by request ID.
- Inspect migration and connection pool status.

## Triage
- Verify `DATABASE_URL`, SSL mode, and provider status.
- Check slow or failed queries around the incident window.
- Confirm no migration is partially applied.

## Mitigate
- Disable non-critical background jobs if the database is degraded.
- Roll back the last migration only through an approved database procedure.
- Restore from backup if data corruption is confirmed.

## Follow-Up
- Add missing indexes or query guards.
- Record backup restore evidence and recovery time.
