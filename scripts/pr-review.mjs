#!/usr/bin/env node

/**
 * Automated PR-review harness for the SecondOp "software factory".
 *
 * Gathers the review context defined in docs/PR_REVIEW_AGENT.md (diff, changed
 * files, checklist, severity scale) and emits a review scaffold as Markdown.
 *
 * If SECONDOP_REVIEW_CMD is set (e.g. a Claude Code / model command), it is run
 * with the context file as its final argument and its stdout becomes the review
 * body. Otherwise the deterministic checklist scaffold is produced so the step
 * still posts an actionable, grounded review even without model access.
 *
 * The review NEVER approves merge, dismisses required reviews, deploys, or
 * resolves security/product decisions — those stay human-gated per AGENTS.md.
 *
 * Usage:
 *   node scripts/pr-review.mjs --base origin/main --head HEAD --out review.md
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const SECRET_PATTERN =
  /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s"]+)/g;

const CHECKLIST = [
  ['Scope discipline', 'PR matches the Linear issue; no unrelated refactors, churn, or dep changes; ledger updated.'],
  ['Architecture fit', 'Follows repo patterns; controllers thin; reuse over ad hoc layers; respects AI_CONTRACT.md.'],
  ['Test coverage', 'Right checks run; tests for logic/permissions/API/AI/persistence; gaps explained.'],
  ['Security & privacy', 'No secrets/PHI/payment data in code, logs, docs, or ledger; new routes authorized server-side.'],
  ['AI / medical traceability', 'AI outputs schema-valid with confidence; medical claims map to source; de-ID fail-closed.'],
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base || 'origin/main';
  const head = args.head || 'HEAD';

  const mergeBase = tryGit(['merge-base', base, head]) || base;
  const nameStatus = tryGit(['diff', '--name-status', `${mergeBase}...${head}`]) || '';
  const shortstat = tryGit(['diff', '--shortstat', `${mergeBase}...${head}`]) || '';
  const diff = tryGit(['diff', `${mergeBase}...${head}`]) || '';

  const changedFiles = nameStatus
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/\s+/g, ' ').trim());

  const contextPath = args.context || 'pr-review-context.md';
  writeFileSync(contextPath, buildContext({ base, head, mergeBase, shortstat, changedFiles, diff }));

  let body;
  if (process.env.SECONDOP_REVIEW_CMD) {
    body = runReviewCommand(process.env.SECONDOP_REVIEW_CMD, contextPath);
  }
  if (!body) {
    body = buildScaffold({ base, head, shortstat, changedFiles });
  }

  const outPath = args.out || 'pr-review.md';
  writeFileSync(outPath, sanitize(body));
  console.log(`PR review written to ${outPath} (${changedFiles.length} changed file(s)).`);
}

function buildContext({ base, head, mergeBase, shortstat, changedFiles, diff }) {
  // Cap the diff so a huge PR does not blow the model/context budget.
  const cappedDiff = diff.length > 200_000 ? `${diff.slice(0, 200_000)}\n\n...[diff truncated]...` : diff;
  return sanitize(
    [
      `# PR review context`,
      `Base: ${base}  Head: ${head}  Merge-base: ${mergeBase}`,
      `Changes: ${shortstat || 'n/a'}`,
      '',
      '## Changed files',
      changedFiles.map((f) => `- ${f}`).join('\n') || '- (none)',
      '',
      '## Review contract',
      'Apply docs/PR_REVIEW_AGENT.md. Severity: P0 (block, security/data-loss/outage),',
      'P1 (block, user-visible bug/auth/data risk/failed acceptance), P2 (should-fix),',
      'P3 (optional). Report only actionable, evidence-grounded findings. Do NOT approve',
      'merge, deploy, or resolve security/product decisions.',
      '',
      '## Diff',
      '```diff',
      cappedDiff,
      '```',
      '',
    ].join('\n')
  );
}

function buildScaffold({ base, head, shortstat, changedFiles }) {
  return [
    '## 🤖 Automated PR review',
    '',
    `Base \`${base}\` → head \`${head}\`. ${shortstat || 'No stat available.'}`,
    '',
    `**Changed files (${changedFiles.length}):**`,
    changedFiles.slice(0, 40).map((f) => `- \`${f}\``).join('\n') || '- (none)',
    changedFiles.length > 40 ? `- …and ${changedFiles.length - 40} more` : '',
    '',
    '### Checklist (per docs/PR_REVIEW_AGENT.md)',
    '',
    CHECKLIST.map(([name, ask]) => `- [ ] **${name}** — ${ask}`).join('\n'),
    '',
    '### Findings',
    '',
    '_No model reviewer configured (`SECONDOP_REVIEW_CMD` unset), so this is the checklist',
    'scaffold only. A human reviewer should complete it, or configure a model command._',
    '',
    '**Severity:** P0 block (security/data-loss/outage) · P1 block (user-visible/auth/data) · P2 should-fix · P3 optional',
    '',
    '> This automated review never approves merge, deploys, or resolves security/product',
    '> decisions — those remain human-gated (AGENTS.md).',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function runReviewCommand(cmd, contextPath) {
  try {
    const [bin, ...rest] = cmd.split(' ');
    const out = execFileSync(bin, [...rest, contextPath], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    return out && out.trim() ? out.trim() : null;
  } catch (error) {
    return `## 🤖 Automated PR review\n\nReview command failed: ${sanitize(String(error.message || error))}\n\nFall back to manual review per docs/PR_REVIEW_AGENT.md.`;
  }
}

function tryGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

function sanitize(value) {
  return String(value ?? '').replace(SECRET_PATTERN, '[REDACTED]');
}

function parseArgs(argv) {
  const parsed = { base: null, head: null, out: null, context: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--base' && next) { parsed.base = next; i += 1; }
    else if (arg === '--head' && next) { parsed.head = next; i += 1; }
    else if (arg === '--out' && next) { parsed.out = next; i += 1; }
    else if (arg === '--context' && next) { parsed.context = next; i += 1; }
    else if (arg === '--help' || arg === '-h') { console.log('Usage: node scripts/pr-review.mjs --base origin/main --head HEAD --out pr-review.md'); process.exit(0); }
    else { throw new Error(`Unknown or incomplete argument: ${arg}`); }
  }
  return parsed;
}

main();
