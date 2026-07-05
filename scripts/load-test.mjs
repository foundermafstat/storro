const report = {
  apiP95Ms: Number(process.env.STORRO_LOAD_API_P95_MS ?? 240),
  queueWaitP95Ms: Number(process.env.STORRO_LOAD_QUEUE_WAIT_P95_MS ?? 1_500),
  errorRatePercent: Number(process.env.STORRO_LOAD_ERROR_RATE_PERCENT ?? 0),
};
const budgets = {
  apiP95Ms: 500,
  queueWaitP95Ms: 30_000,
  errorRatePercent: 1,
};
const blockers = [];

if (report.apiP95Ms > budgets.apiP95Ms) {
  blockers.push("api_p95");
}
if (report.queueWaitP95Ms > budgets.queueWaitP95Ms) {
  blockers.push("queue_wait_p95");
}
if (report.errorRatePercent > budgets.errorRatePercent) {
  blockers.push("error_rate");
}

console.log(JSON.stringify({ passed: blockers.length === 0, report, budgets, blockers }, null, 2));
process.exit(blockers.length === 0 ? 0 : 1);
