# Rollback, Backup, and Restore

## Rollback

1. Stop promotion and keep the previous web and worker version serving traffic.
2. If web is already promoted, redeploy the previous successful commit SHA.
3. Do not roll back database migrations by hand while workers are running.
4. Pause non-critical queues if the rollback relates to schema or billing.
5. Run `npm run deploy:health` after rollback.

## Migration Safety

- Production uses `npm run deploy:migrate`, which runs `prisma migrate deploy`.
- Migrations must be backward compatible with the previous web and worker version.
- Destructive migrations require a separate backup and restore drill.

## Backup Policy

- PostgreSQL: daily automated backups, point-in-time recovery enabled.
- Object storage: versioning enabled for source uploads and exports.
- Redis: no source of truth; queues can be reconstructed from jobs where needed.

## Restore Drill

1. Restore PostgreSQL backup into staging.
2. Point staging object storage to a restored bucket copy.
3. Run `npm run deploy:health`.
4. Run targeted smoke tests: auth, project load, source download, artifact export, billing webhook fixture.
5. Record restore time and data loss window.
