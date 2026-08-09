#!/usr/bin/env ts-node
import { readFileSync } from 'fs';
import { GoldEvalReport } from '../src/evals/goldEvalHarness';
import { persistGoldEvalReport } from '../src/services/goldEvalRuns.service';

const main = async () => {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error('Usage: ts-node scripts/persist-gold-report.ts <gold-report.json>');
  }

  if (!process.env.DATABASE_URL && !process.env.DB_NAME) {
    process.stdout.write('Skipping gold report persistence: DATABASE_URL/DB_NAME not configured.\n');
    return;
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as GoldEvalReport;
  const result = await persistGoldEvalReport(report, {
    gitSha: process.env.GITHUB_SHA || process.env.BACKEND_GIT_SHA || process.env.GIT_SHA || null,
  });
  process.stdout.write(`Persisted gold eval rows: ${result.ids.join(', ')}\n`);
};

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
