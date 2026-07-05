# Launch Checklist

## Quality

- [x] Unit, integration, E2E, and AI evaluation suites are defined.
- [x] Critical coverage report has no untested critical services.
- [x] Secret scan and dependency audit are CI gates.

## Performance

- [x] Load test script exists: `npm run load:test`.
- [x] API p95 budget: 500ms.
- [x] Queue wait p95 budget: 30s.
- [x] Error rate budget: 1%.

## Accessibility

- [x] Accessibility check script exists: `npm run accessibility:check`.
- [x] Core pages expose `main` and `h1` landmarks.

## Privacy and Compliance

- [x] `/legal/privacy` exists.
- [x] `/legal/terms` exists.
- [x] Organization export and deletion flows exist.
- [x] Support console hides raw source content by default.

## Launch Monitoring

- [x] Admin launch monitoring page exists at `/admin/launch`.
- [x] Runbooks exist for AI, GitHub webhooks, queues, database, and billing webhooks.

## Blockers

No critical implementation blockers are open in this checklist.
