# CI/CD Quality Gates

## Required Pull Request Checks

The `CI` workflow must be required before merge to `main`.

Required checks:

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run test:ai-eval`
- `npm run coverage:critical`
- `npm run prisma:validate`
- `npm run secret:scan`
- `npm run audit:ci`
- `npm run build`

## Environment Promotion

- Preview deployments run for pull requests.
- Staging deployments run from `main` after quality verification.
- Production deployments are manual, run only from `main`, require a matching commit SHA, and rerun all quality gates before deployment.

## Branch Protection

Configure GitHub branch protection for `main`:

- require pull request review before merge;
- require the `Quality Gates` job from the `CI` workflow;
- require branches to be up to date before merge;
- restrict direct pushes except release automation;
- require signed or verified commits when available.

## Artifacts

The CI workflow uploads a `ci-summary` artifact with commit, job, and completion metadata. Future stages can add coverage, Playwright, Prisma, and AI evaluation reports to the same artifact path.

## Deployment Gates

Staging and production deployments run:

- `npm run deploy:migrate`
- `npm run deploy:health`
- `npm run worker:health`

Provider-specific web and worker rollout commands are environment-owned and must keep web and worker independently scalable.
