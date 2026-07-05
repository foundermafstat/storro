# Billing Webhook Failures Runbook

## Detect
- Alert: any Stripe billing webhook failure for subscription or invoice events.
- Check `WebhookDelivery` entries with provider `STRIPE`.

## Triage
- Verify `STRIPE_WEBHOOK_SECRET`.
- Recompute signature using the raw request body if needed.
- Match Stripe event ID with local delivery ID.

## Mitigate
- Replay the Stripe event after fixing signature or schema handling.
- Manually reconcile `BillingAccount` only with audit trail.
- Keep quota enforcement conservative when subscription status is uncertain.

## Follow-Up
- Add the Stripe event fixture to billing tests.
- Confirm affected customers received accurate billing notifications.
