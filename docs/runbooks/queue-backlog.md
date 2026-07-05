# Queue Backlog Runbook

## Detect
- Alert: queued jobs exceed 100 or queue wait time exceeds the product SLO.
- Check job traces for `queueWaitMs` and `processingDurationMs`.

## Triage
- Group backlog by `queueName`, `type`, and `status`.
- Identify locked jobs with repeated attempts.
- Check Redis and worker health.

## Mitigate
- Scale workers for the affected queue.
- Cancel poisoned jobs after preserving payload and error evidence.
- Reduce AI or GitHub sync concurrency if upstream limits are active.

## Follow-Up
- Add a regression test for the job type that caused backlog.
- Update queue thresholds if normal traffic changed.
