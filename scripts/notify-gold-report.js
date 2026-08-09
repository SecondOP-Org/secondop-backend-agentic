#!/usr/bin/env node
const fs = require('fs');

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: node scripts/notify-gold-report.js <gold-report.json>');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const baseline = report.baseline || {};
const agentic = report.agentic || {};
const summary = [
  `Gold eval ${report.goldSetVersion || 'unknown'} (${report.mode || 'unknown'})`,
  `gatePassed=${report.gatePassed}`,
  `baseline safety=${baseline.safetyPassRate ?? 'n/a'} correctness=${baseline.meanCorrectness ?? 'n/a'}`,
  `agentic safety=${agentic.safetyPassRate ?? 'n/a'} correctness=${agentic.meanCorrectness ?? 'n/a'}`,
  ...(Array.isArray(report.gateFailures) && report.gateFailures.length
    ? [`failures: ${report.gateFailures.join('; ')}`]
    : []),
].join('\n');

console.log(summary);

const webhook = process.env.GOLD_EVAL_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL;
if (!webhook) {
  process.exit(report.gatePassed === false ? 0 : 0);
}

fetch(webhook, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    text: summary,
    gatePassed: report.gatePassed,
    goldSetVersion: report.goldSetVersion,
  }),
})
  .then((response) => {
    if (!response.ok) {
      console.error(`Webhook notify failed: HTTP ${response.status}`);
      process.exitCode = 1;
      return;
    }
    console.log('Gold eval webhook notified.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
