# Production Deployment and Infrastructure

## Services

- Web app: Next.js app with NextAuth/Auth.js and API routes.
- Worker: independent Node worker process using the same typed env contract.
- PostgreSQL: managed production database with `prisma migrate deploy`.
- Redis: managed Redis for queues and rate-sensitive worker coordination.
- Object storage: S3-compatible bucket for uploads, exports, and large payloads.

## Promotion Flow

1. Preview builds run on pull requests.
2. Staging deploy runs from `main`.
3. Production deploy is manual and requires the exact `main` commit SHA.
4. Migrations run before provider rollout.
5. Health checks validate config and connectivity before traffic promotion.

## Health Checks

Run:

```bash
npm run deploy:health
```

Checks:

- database: connects and runs `select 1`;
- redis: opens TCP/TLS connection;
- queue: validates Redis queue connectivity path;
- object storage: endpoint responds below 500;
- web: `NEXT_PUBLIC_APP_URL` configured;
- worker: `WORKER_BASE_URL` configured.

## Scaling

- Scale web and worker independently.
- Keep workers stateless.
- Use queue depth and job trace metrics to decide worker count.

## Required Secrets

Use `docs/config/production.env.example` as the source of truth for required keys. GitHub environments must expose matching secrets and model variables.
