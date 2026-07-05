# GitHub Webhook Failures Runbook

## Detect
- Alert: GitHub webhook failures exceed 10 deliveries in 15 minutes.
- Check webhook delivery status and signature validity in admin console.

## Triage
- Verify `GITHUB_APP_WEBHOOK_SECRET`.
- Compare GitHub delivery ID with `WebhookDelivery.deliveryId`.
- Check `WEBHOOK_PROCESS` and `GITHUB_SYNC` job errors.

## Mitigate
- Replay failed delivery after fixing signature or payload validation.
- Reconnect the GitHub App if permissions changed.
- Pause write actions until ingestion is healthy.

## Follow-Up
- Add fixture for the failed event type.
- Document permission changes in the organization audit log.
