#!/usr/bin/env node

/**
 * Autonomous dispatch loop for the SecondOp "software factory".
 *
 * Picks up Linear issues that are ready for code (`Todo`) and prepares an
 * isolated worktree + branch + handoff brief for the coding agent — stopping
 * BEFORE any human-gated action (merge, deploy, production config, secrets).
 *
 * The actual coding agent is pluggable: set `SECONDOP_CODING_AGENT_CMD` to a
 * command that receives the handoff brief path as its final argument. Without
 * it, dispatch runs in --plan mode and only prepares the workspace + brief so a
 * human (or an interactive agent like Cursor/Claude) can take over.
 *
 * This script never merges, deploys, changes production config, touches
 * secrets, or pushes to main. Those gates live in AGENTS.md and stay human-only.
 *
 * Usage:
 *   node scripts/dispatch.mjs --linear-snapshot <file> [--status Todo] [--limit N]
 *   node scripts/dispatch.mjs --issue SEC-241 --title "short title"
 *   node scripts/dispatch.mjs --issue SEC-241 --run        # invoke coding agent
 *
 * A sanitized Linear snapshot is the same JSON shape consumed by
 * scripts/command-center-report.mjs: an array of issues, or `{ issues: [...] }`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const READY_STATUS = 'Todo';
const SECRET_PATTERN =
  /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s"]+)/g;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(
    args.workspaceRoot || process.env.SECONDOP_WORKSPACE_ROOT || findWorkspaceRoot(repoRoot)
  );
  const worktreeRoot = path.resolve(
    args.worktreeRoot || process.env.SECONDOP_WORKTREE_ROOT || path.join(workspaceRoot, '.worktrees')
  );

  const candidates = resolveCandidates(args);
  if (candidates.length === 0) {
    console.log('No ready-for-code issues found. Nothing to dispatch.');
    return;
  }

  const selected = candidates.slice(0, args.limit);
  const dispatched = [];

  for (const issue of selected) {
    dispatched.push(dispatchIssue(issue, { args, worktreeRoot }));
  }

  const outDir = path.resolve(args.outDir || path.join(repoRoot, 'temp', 'dispatch'));
  mkdirSync(outDir, { recursive: true });
  const planPath = path.join(outDir, 'dispatch-plan.json');
  const plan = {
    generatedAt: new Date().toISOString(),
    mode: args.run ? 'run' : 'plan',
    workspaceRoot: sanitize(workspaceRoot),
    worktreeRoot: sanitize(worktreeRoot),
    readyStatus: args.status,
    considered: candidates.length,
    dispatched,
    humanGates: [
      'Merging a PR',
      'Deploying or changing production config',
      'Rotating or viewing secrets',
      'Destructive/data-migration commands on shared environments',
    ],
  };
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  console.log(`\nDispatch plan (${plan.mode}) written to ${planPath}`);
  for (const entry of dispatched) {
    console.log(
      `  ${entry.issue}  ${entry.branch}  →  ${entry.status}${
        entry.worktree ? `  (${sanitize(entry.worktree)})` : ''
      }`
    );
  }
  if (!args.run) {
    console.log(
      '\nplan mode: workspace + handoff brief prepared, no coding agent invoked.\n' +
        'Pass --run (with SECONDOP_CODING_AGENT_CMD set) to hand off to the coding agent.'
    );
  }
}

function dispatchIssue(issue, { args, worktreeRoot }) {
  const key = issue.identifier || issue.id;
  const branch = branchName(key, issue.title);
  const worktreePath = path.join(worktreeRoot, `${slug(key)}-backend`);

  const record = {
    issue: key,
    title: sanitize(issue.title || ''),
    branch,
    worktree: null,
    briefPath: null,
    status: 'prepared',
    notes: [],
  };

  if (existingBranch(branch)) {
    record.status = 'exists';
    record.notes.push('Branch already exists; skipped creation. Reuse the existing worktree.');
  } else if (args.dryRun) {
    record.status = 'dry-run';
  } else {
    try {
      createWorktree(branch, worktreePath);
      record.worktree = worktreePath;
    } catch (error) {
      record.status = 'error';
      record.notes.push(`Worktree creation failed: ${sanitize(String(error.message || error))}`);
      return record;
    }
  }

  const targetDir = record.worktree && existsSync(record.worktree) ? record.worktree : repoRoot;
  record.briefPath = writeHandoffBrief(issue, { branch, targetDir });

  if (args.run && record.status !== 'error') {
    record.status = invokeCodingAgent(record.briefPath, targetDir, record);
  }

  return record;
}

function invokeCodingAgent(briefPath, cwd, record) {
  const cmd = process.env.SECONDOP_CODING_AGENT_CMD;
  if (!cmd) {
    record.notes.push(
      'SECONDOP_CODING_AGENT_CMD not set; --run had nothing to invoke. Workspace + brief are ready for a human/interactive agent.'
    );
    return 'ready-for-agent';
  }
  try {
    const [bin, ...rest] = cmd.split(' ');
    execFileSync(bin, [...rest, briefPath], { cwd, stdio: 'inherit' });
    return 'agent-invoked';
  } catch (error) {
    record.notes.push(`Coding agent command failed: ${sanitize(String(error.message || error))}`);
    return 'agent-error';
  }
}

function writeHandoffBrief(issue, { branch, targetDir }) {
  const key = issue.identifier || issue.id;
  const briefDir = path.join(targetDir, 'temp', 'dispatch');
  mkdirSync(briefDir, { recursive: true });
  const briefPath = path.join(briefDir, `${slug(key)}-handoff.md`);

  const acceptance = Array.isArray(issue.acceptanceCriteria)
    ? issue.acceptanceCriteria
    : issue.acceptanceCriteria
      ? [issue.acceptanceCriteria]
      : [];

  const lines = [
    `# Coding handoff — ${key}`,
    '',
    `- **Issue:** ${key} — ${sanitize(issue.title || 'untitled')}`,
    `- **Status:** ${issue.status || READY_STATUS}`,
    `- **Priority:** ${issue.priority ?? 'unset'}`,
    `- **Branch:** ${branch}`,
    issue.url ? `- **Linear:** ${sanitize(issue.url)}` : null,
    '',
    '## Problem',
    '',
    sanitize(issue.description || issue.problem || '(No description in snapshot — read the Linear issue.)'),
    '',
    '## Acceptance criteria',
    '',
    acceptance.length > 0
      ? acceptance.map((item) => `- [ ] ${sanitize(String(item))}`).join('\n')
      : '- [ ] (Derive from the Linear issue; refine the spec first if not implementation-ready.)',
    '',
    '## Coding-agent contract (AGENTS.md)',
    '',
    '1. Inspect the repo before editing; follow existing patterns.',
    '2. Implement the smallest correct change end to end.',
    '3. Add/update tests for logic, permissions, API, AI behavior, persistence, or reusable services.',
    '4. AI/medical changes must comply with `docs/AI_CONTRACT.md` (schema, confidence, traceability, de-ID).',
    '5. Run: `npm run lint`, `npm test`, `npm run build`.',
    '6. Update `docs/AGENT_RUN_LEDGER.md` with a factual entry.',
    '7. Open a **draft** PR and post the PR-ready summary. Move Linear to `In Review`.',
    '',
    '## Human gates — STOP here',
    '',
    'Do NOT merge, deploy, change production config, rotate/view secrets, run destructive',
    'or shared-environment migrations, or sign off security-sensitive decisions. Those',
    'require explicit human approval.',
    '',
    '_Generated by scripts/dispatch.mjs. Snapshot data only — Linear is the source of truth._',
    '',
  ].filter((line) => line !== null);

  writeFileSync(briefPath, lines.join('\n'));
  return briefPath;
}

function resolveCandidates(args) {
  if (args.issues.length > 0) {
    return args.issues.map((key) => ({ identifier: key, title: args.title || '', status: READY_STATUS }));
  }
  const snapshot = loadLinearSnapshot(args.linearSnapshot);
  return snapshot.filter((issue) => normalizeStatus(issue.status) === normalizeStatus(args.status));
}

function loadLinearSnapshot(snapshotPath) {
  if (!snapshotPath) {
    return [];
  }
  const raw = JSON.parse(readFileSync(path.resolve(snapshotPath), 'utf8'));
  return Array.isArray(raw) ? raw : raw.issues || [];
}

// ---- git helpers -----------------------------------------------------------

function existingBranch(branch) {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

function createWorktree(branch, worktreePath) {
  if (existsSync(worktreePath)) {
    throw new Error(`worktree path already exists: ${worktreePath}`);
  }
  mkdirSync(path.dirname(worktreePath), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

// ---- naming / sanitizing ---------------------------------------------------

function branchName(key, title) {
  const base = slug(key);
  const rest = title ? slug(title).slice(0, 40).replace(/^-+|-+$/g, '') : '';
  return rest ? `${base}-${rest}` : base;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function sanitize(value) {
  return String(value ?? '').replace(SECRET_PATTERN, '[REDACTED]');
}

function findWorkspaceRoot(startPath) {
  let current = startPath;
  while (current !== path.dirname(current)) {
    if (
      existsSync(path.join(current, 'secondop-backend-agentic')) &&
      existsSync(path.join(current, 'secondop-fe-agentic'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return path.dirname(startPath);
}

function parseArgs(argv) {
  const parsed = {
    issues: [],
    title: null,
    linearSnapshot: null,
    status: READY_STATUS,
    limit: Number(process.env.SECONDOP_DISPATCH_LIMIT || 1),
    outDir: null,
    workspaceRoot: null,
    worktreeRoot: null,
    run: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--issue' && next) {
      parsed.issues.push(next);
      index += 1;
    } else if (arg === '--title' && next) {
      parsed.title = next;
      index += 1;
    } else if (arg === '--linear-snapshot' && next) {
      parsed.linearSnapshot = next;
      index += 1;
    } else if (arg === '--status' && next) {
      parsed.status = next;
      index += 1;
    } else if (arg === '--limit' && next) {
      parsed.limit = Math.max(1, Number(next) || 1);
      index += 1;
    } else if (arg === '--out-dir' && next) {
      parsed.outDir = next;
      index += 1;
    } else if (arg === '--workspace-root' && next) {
      parsed.workspaceRoot = next;
      index += 1;
    } else if (arg === '--worktree-root' && next) {
      parsed.worktreeRoot = next;
      index += 1;
    } else if (arg === '--run') {
      parsed.run = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run factory:dispatch -- [options]

Selects ready-for-code issues and prepares isolated worktrees + handoff briefs.
Never merges, deploys, changes production config, or touches secrets.

Options:
  --issue SEC-241            Dispatch a specific issue key. Repeatable.
  --title "short title"      Title used for branch naming with --issue.
  --linear-snapshot <path>   Sanitized Linear snapshot JSON (array or { issues }).
  --status Todo              Ready-for-code status to select (default: Todo).
  --limit N                  Max issues to dispatch per run (default: 1).
  --run                      Invoke SECONDOP_CODING_AGENT_CMD after prep.
  --dry-run                  Plan only; do not create worktrees.
  --out-dir <path>           Plan output dir (default: temp/dispatch).
  --workspace-root <path>    Workspace containing frontend/backend repos.
  --worktree-root <path>     Where worktrees are created (default: <ws>/.worktrees).

Env:
  SECONDOP_CODING_AGENT_CMD  Command to run per issue; receives the brief path.
  SECONDOP_DISPATCH_LIMIT    Default --limit.`);
}

main();
