#!/usr/bin/env node

/**
 * Foreground supervisor for factory dispatch.
 *
 * Runs scripts/dispatch.mjs on an interval, writes a heartbeat/lock so operators
 * can tell whether it is active, and accepts a stop request via state file.
 * This service does not merge, deploy, change production config, rotate secrets,
 * or bypass the human gates in AGENTS.md.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const DEFAULT_STATE_DIR = path.join(repoRoot, 'temp', 'dispatch-service');
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const SECRET_PATTERN =
  /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s"]+)/g;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.command === 'status') {
    printStatus(args);
    return;
  }

  if (args.command === 'stop') {
    requestStop(args);
    return;
  }

  runService(args);
}

function runService(args) {
  mkdirSync(args.stateDir, { recursive: true });
  acquireLock(args);
  removeStopRequest(args);

  const logPath = path.join(args.stateDir, 'dispatch-service.log');
  const startedAt = new Date().toISOString();
  let cycle = 0;
  let stopping = false;

  const shutdown = () => {
    stopping = true;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    writeHeartbeat(args, {
      status: 'active',
      startedAt,
      heartbeatAt: startedAt,
      cycle,
      lastResult: null,
    });

    while (!stopping) {
      cycle += 1;
      const cycleStartedAt = new Date().toISOString();
      writeHeartbeat(args, {
        status: 'running-cycle',
        startedAt,
        heartbeatAt: cycleStartedAt,
        cycle,
        lastResult: null,
      });

      const result = runDispatchCycle(args, logPath);
      writeHeartbeat(args, {
        status: 'active',
        startedAt,
        heartbeatAt: new Date().toISOString(),
        cycle,
        lastResult: result,
      });

      if (args.maxCycles && cycle >= args.maxCycles) {
        break;
      }
      if (existsSync(stopPath(args))) {
        break;
      }
      sleep(args.intervalMs);
    }

    writeHeartbeat(args, {
      status: 'stopped',
      startedAt,
      heartbeatAt: new Date().toISOString(),
      cycle,
      lastResult: { code: 0, reason: 'normal-stop' },
    });
  } finally {
    releaseLock(args);
    removeStopRequest(args);
  }
}

function runDispatchCycle(args, logPath) {
  const dispatchArgs = ['scripts/dispatch.mjs'];
  const linearSnapshot = args.linearLive ? writeLiveLinearSnapshot(args, logPath) : args.linearSnapshot;
  for (const issue of args.issues) {
    dispatchArgs.push('--issue', issue);
  }
  if (args.title) {
    dispatchArgs.push('--title', args.title);
  }
  if (linearSnapshot) {
    dispatchArgs.push('--linear-snapshot', linearSnapshot);
  }
  dispatchArgs.push('--status', args.status);
  dispatchArgs.push('--limit', String(args.limit));
  dispatchArgs.push('--out-dir', path.join(args.stateDir, 'dispatch'));
  if (args.workspaceRoot) {
    dispatchArgs.push('--workspace-root', args.workspaceRoot);
  }
  if (args.worktreeRoot) {
    dispatchArgs.push('--worktree-root', args.worktreeRoot);
  }
  if (args.run) {
    dispatchArgs.push('--run');
  }
  if (args.dryRun) {
    dispatchArgs.push('--dry-run');
  }

  const startedAt = new Date().toISOString();
  appendLog(logPath, `\n[${startedAt}] dispatch cycle: node ${dispatchArgs.map(shellish).join(' ')}\n`);

  const result = spawnSync(process.execPath, dispatchArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  });

  if (result.stdout) {
    appendLog(logPath, result.stdout);
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    appendLog(logPath, result.stderr);
    process.stderr.write(result.stderr);
  }

  const endedAt = new Date().toISOString();
  const summary = {
    code: result.status ?? 1,
    signal: result.signal,
    startedAt,
    endedAt,
    mode: args.run ? 'run' : 'plan',
    snapshot: linearSnapshot ? sanitize(linearSnapshot) : null,
    linearLive: args.linearLive,
    issues: args.issues,
  };
  appendLog(logPath, `[${endedAt}] dispatch cycle exit=${summary.code}${summary.signal ? ` signal=${summary.signal}` : ''}\n`);
  return summary;
}

async function fetchLiveLinearIssues(args) {
  const token = process.env.SECONDOP_LINEAR_API_KEY || process.env.LINEAR_API_KEY;
  if (!token) {
    throw new Error('Live Linear dispatch requires SECONDOP_LINEAR_API_KEY or LINEAR_API_KEY.');
  }

  const query = `
    query DispatchIssues($team: String!, $status: String!, $first: Int!) {
      issues(
        first: $first
        filter: {
          team: { name: { eq: $team } }
          state: { name: { eq: $status } }
          archivedAt: { null: true }
        }
        orderBy: updatedAt
      ) {
        nodes {
          identifier
          title
          description
          url
          priority
          state { name }
          labels { nodes { name } }
          assignee { name email }
        }
      }
    }
  `;

  const response = await fetch(args.linearApiUrl, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {
        team: args.linearTeam,
        status: args.status,
        first: args.limit,
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(`Linear API error: ${sanitize(JSON.stringify(payload.errors || payload))}`);
  }

  return (payload.data?.issues?.nodes || []).map((issue) => ({
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    url: issue.url,
    priority: issue.priority,
    status: issue.state?.name,
    labels: (issue.labels?.nodes || []).map((label) => label.name),
    assignee: issue.assignee?.email || issue.assignee?.name || null,
  }));
}

function writeLiveLinearSnapshot(args, logPath) {
  const snapshotPath = path.join(args.stateDir, 'linear-live-snapshot.json');
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `
        import('${new URL(import.meta.url).href}')
          .then(async (mod) => {
            const issues = await mod.__fetchLiveLinearIssuesForService(${JSON.stringify({
              linearApiUrl: args.linearApiUrl,
              linearTeam: args.linearTeam,
              status: args.status,
              limit: args.limit,
            })});
            process.stdout.write(JSON.stringify({ issues }, null, 2));
          })
          .catch((error) => {
            console.error(error.message || String(error));
            process.exit(1);
          });
      `,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    }
  );

  if (child.status !== 0) {
    appendLog(logPath, `Live Linear snapshot failed: ${child.stderr || child.stdout}\n`);
    throw new Error(`Live Linear snapshot failed: ${sanitize(child.stderr || child.stdout)}`);
  }

  writeFileSync(snapshotPath, `${child.stdout}\n`);
  appendLog(logPath, `Live Linear snapshot written to ${snapshotPath}\n`);
  return snapshotPath;
}

function printStatus(args) {
  if (!existsSync(lockPath(args))) {
    console.log(`dispatch service: stopped (${lockPath(args)} not present)`);
    return;
  }
  const state = readJson(lockPath(args));
  const stopRequested = existsSync(stopPath(args));
  console.log(
    JSON.stringify(
      {
        active: isPidAlive(state.pid),
        stopRequested,
        state,
      },
      null,
      2
    )
  );
}

function requestStop(args) {
  mkdirSync(args.stateDir, { recursive: true });
  writeFileSync(
    stopPath(args),
    `${JSON.stringify({ requestedAt: new Date().toISOString(), requestedByPid: process.pid }, null, 2)}\n`
  );
  console.log(`dispatch service stop requested: ${stopPath(args)}`);
}

function acquireLock(args) {
  const lock = lockPath(args);
  if (existsSync(lock)) {
    const state = readJson(lock);
    if (isPidAlive(state.pid)) {
      throw new Error(`Dispatch service already active with pid ${state.pid}. Run status or stop first.`);
    }
    rmSync(lock, { force: true });
  }

  const fd = openSync(lock, 'wx');
  closeSync(fd);
}

function releaseLock(args) {
  rmSync(lockPath(args), { force: true });
}

function writeHeartbeat(args, state) {
  const payload = {
    ...state,
    pid: process.pid,
    command: args.command,
    intervalMs: args.intervalMs,
    stateDir: sanitize(args.stateDir),
    linearSnapshot: args.linearSnapshot ? sanitize(args.linearSnapshot) : null,
    issues: args.issues,
    run: args.run,
    dryRun: args.dryRun,
    humanGates: [
      'No merge',
      'No deploy',
      'No production config changes',
      'No secret rotation or viewing',
      'No destructive shared-environment actions',
    ],
  };
  writeFileSync(lockPath(args), `${JSON.stringify(payload, null, 2)}\n`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isPidAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid))) {
    return false;
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function appendLog(filePath, value) {
  appendFileSync(filePath, sanitize(value));
}

function lockPath(args) {
  return path.join(args.stateDir, 'dispatch-service.lock.json');
}

function stopPath(args) {
  return path.join(args.stateDir, 'dispatch-service.stop.json');
}

function removeStopRequest(args) {
  rmSync(stopPath(args), { force: true });
}

function sanitize(value) {
  return String(value ?? '').replace(SECRET_PATTERN, '[REDACTED]');
}

function shellish(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'start';
  const rest = command === argv[0] ? argv.slice(1) : argv;
  const parsed = {
    command,
    issues: [],
    title: null,
    linearSnapshot: process.env.SECONDOP_LINEAR_SNAPSHOT || null,
    status: process.env.SECONDOP_DISPATCH_STATUS || 'Todo',
    limit: positiveInt(process.env.SECONDOP_DISPATCH_LIMIT, 1),
    intervalMs: positiveInt(process.env.SECONDOP_DISPATCH_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    maxCycles: command === 'once' ? 1 : null,
    stateDir: path.resolve(process.env.SECONDOP_DISPATCH_STATE_DIR || DEFAULT_STATE_DIR),
    workspaceRoot: process.env.SECONDOP_WORKSPACE_ROOT || null,
    worktreeRoot: process.env.SECONDOP_WORKTREE_ROOT || null,
    run: false,
    dryRun: false,
    help: false,
    linearLive: process.env.SECONDOP_LINEAR_LIVE === 'true',
    linearTeam: process.env.SECONDOP_LINEAR_TEAM || 'SecondOP',
    linearApiUrl: process.env.SECONDOP_LINEAR_API_URL || 'https://api.linear.app/graphql',
  };

  if (!['start', 'once', 'status', 'stop'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === '--issue' && next) {
      parsed.issues.push(next);
      index += 1;
    } else if (arg === '--title' && next) {
      parsed.title = next;
      index += 1;
    } else if (arg === '--linear-snapshot' && next) {
      parsed.linearSnapshot = next;
      index += 1;
    } else if (arg === '--linear-live') {
      parsed.linearLive = true;
    } else if (arg === '--linear-team' && next) {
      parsed.linearTeam = next;
      index += 1;
    } else if (arg === '--linear-api-url' && next) {
      parsed.linearApiUrl = next;
      index += 1;
    } else if (arg === '--status' && next) {
      parsed.status = next;
      index += 1;
    } else if (arg === '--limit' && next) {
      parsed.limit = positiveInt(next, 1);
      index += 1;
    } else if (arg === '--interval-ms' && next) {
      parsed.intervalMs = positiveInt(next, DEFAULT_INTERVAL_MS);
      index += 1;
    } else if (arg === '--max-cycles' && next) {
      parsed.maxCycles = positiveInt(next, 1);
      index += 1;
    } else if (arg === '--state-dir' && next) {
      parsed.stateDir = path.resolve(next);
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
      parsed.help = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return parsed;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`Usage: npm run factory:dispatch:service -- <command> [options]

Commands:
  start                    Run dispatch cycles until stopped (foreground service).
  once                     Run exactly one dispatch cycle, then exit.
  status                   Print lock/heartbeat state.
  stop                     Request a running service to stop after its current cycle.

Options:
  --linear-snapshot <path> Sanitized Linear snapshot JSON to poll.
  --linear-live            Fetch Todo issues from Linear each cycle.
  --linear-team <name>     Linear team for --linear-live (default: SecondOP).
  --linear-api-url <url>   Linear GraphQL endpoint.
  --issue SEC-241          Dispatch a specific issue key. Repeatable.
  --title "short title"    Title used for branch naming with --issue.
  --status Todo            Ready-for-code status to select (default: Todo).
  --limit N                Max issues per cycle (default: 1).
  --interval-ms N          Delay between cycles for start (default: 300000).
  --max-cycles N           Stop after N cycles.
  --run                    Invoke SECONDOP_CODING_AGENT_CMD from dispatch.mjs.
  --dry-run                Do not create worktrees.
  --state-dir <path>       Lock/heartbeat/log directory (default: temp/dispatch-service).
  --workspace-root <path>  Workspace containing frontend/backend repos.
  --worktree-root <path>   Where dispatched worktrees are created.

Env:
  SECONDOP_LINEAR_SNAPSHOT       Default --linear-snapshot.
  SECONDOP_LINEAR_LIVE=true      Enable live Linear polling.
  SECONDOP_LINEAR_API_KEY        Linear API key for live polling.
  LINEAR_API_KEY                 Alternate Linear API key env var.
  SECONDOP_LINEAR_TEAM           Linear team for live polling.
  SECONDOP_DISPATCH_INTERVAL_MS  Default --interval-ms.
  SECONDOP_DISPATCH_STATE_DIR    Default --state-dir.
  SECONDOP_CODING_AGENT_CMD      Optional coding agent command used with --run.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export const __fetchLiveLinearIssuesForService = fetchLiveLinearIssues;
