#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const args = parseArgs(process.argv.slice(2));
const workspaceRoot = path.resolve(
  args.workspaceRoot || process.env.SECONDOP_WORKSPACE_ROOT || findWorkspaceRoot(repoRoot)
);
const outDir = path.resolve(args.outDir || path.join(repoRoot, 'temp', 'command-center'));
const issueKeys = args.issues.length > 0 ? args.issues : ['SEC-38', 'SEC-39', 'SEC-40'];
const generatedAt = new Date().toISOString();

const linearSnapshot = loadLinearSnapshot(args.linearSnapshot);
const repos = [
  {
    key: 'backend',
    name: 'Backend',
    path: repoRoot,
    ledgerPath: path.join(repoRoot, 'docs', 'AGENT_RUN_LEDGER.md'),
    githubRepo: 'SecondOP-Org/secondop-backend-agentic',
  },
  {
    key: 'frontend',
    name: 'Frontend',
    path: path.join(workspaceRoot, 'secondop-fe-agentic'),
    ledgerPath: path.join(workspaceRoot, 'secondop-fe-agentic', 'docs', 'AGENT_RUN_LEDGER.md'),
    githubRepo: 'SecondOP-Org/secondop-frontend',
  },
];

const repoStates = repos.map(readRepoState);
const ledgerEntries = repos.flatMap(readLedgerEntries);
const rows = issueKeys.map((issueKey) => buildIssueRow(issueKey, linearSnapshot, repoStates, ledgerEntries));
const liveDeployments = args.liveDeploys ? readLiveDeployments() : skippedDeploymentStatus();
const report = {
  generatedAt,
  workspaceRoot: sanitizeValue(workspaceRoot),
  outputDirectory: sanitizeValue(outDir),
  dataSources: {
    linearSnapshot: args.linearSnapshot ? sanitizeValue(path.resolve(args.linearSnapshot)) : null,
    githubCli: commandAvailable('gh'),
    liveDeployments: args.liveDeploys,
    ledgers: repos.map((repo) => ({
      repo: repo.key,
      path: sanitizeValue(repo.ledgerPath),
      available: existsSync(repo.ledgerPath),
    })),
  },
  statusCards: buildStatusCards(rows),
  deployments: liveDeployments,
  rows,
  blockers: collectBlockers(rows, liveDeployments),
};

mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, 'command-center-report.json');
const markdownPath = path.join(outDir, 'command-center-report.md');
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, renderMarkdown(report));

console.log(`Command-center report written to ${markdownPath}`);
console.log(`Command-center JSON written to ${jsonPath}`);
if (report.blockers.length > 0) {
  console.log(`Report completed with ${report.blockers.length} blocker(s) or missing data note(s).`);
}

function parseArgs(argv) {
  const parsed = {
    issues: [],
    linearSnapshot: null,
    outDir: null,
    workspaceRoot: null,
    liveDeploys: process.env.COMMAND_CENTER_LIVE_DEPLOYS === '1',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--issue' && next) {
      parsed.issues.push(next);
      index += 1;
    } else if (arg === '--linear-snapshot' && next) {
      parsed.linearSnapshot = next;
      index += 1;
    } else if (arg === '--out-dir' && next) {
      parsed.outDir = next;
      index += 1;
    } else if (arg === '--workspace-root' && next) {
      parsed.workspaceRoot = next;
      index += 1;
    } else if (arg === '--live-deploys') {
      parsed.liveDeploys = true;
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
  console.log(`Usage: npm run command-center:report -- [options]

Options:
  --issue SEC-38                 Include an issue key. Repeat for multiple issues.
  --linear-snapshot <path>       Optional sanitized Linear issue snapshot JSON.
  --out-dir <path>               Output directory. Defaults to temp/command-center.
  --workspace-root <path>        Workspace root containing frontend/backend repos.
  --live-deploys                 Include Railway service status from local CLI context.

The report writes Markdown and JSON to an ignored temp directory by default.`);
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

function loadLinearSnapshot(snapshotPath) {
  if (!snapshotPath) {
    return new Map();
  }

  const absolutePath = path.resolve(snapshotPath);
  const raw = JSON.parse(readFileSync(absolutePath, 'utf8'));
  const issues = Array.isArray(raw) ? raw : raw.issues || [];
  return new Map(issues.map((issue) => [issue.id || issue.identifier, issue]));
}

function readRepoState(repo) {
  if (!existsSync(repo.path)) {
    return {
      repo: repo.key,
      name: repo.name,
      available: false,
      path: sanitizeValue(repo.path),
      branch: 'Unavailable',
      status: 'Repo path not found',
      worktree: sanitizeValue(repo.path),
    };
  }

  return {
    repo: repo.key,
    name: repo.name,
    available: true,
    path: sanitizeValue(repo.path),
    branch: runGit(repo.path, ['branch', '--show-current']) || 'Detached/unknown',
    status: summarizeGitStatus(runGit(repo.path, ['status', '--short', '--branch'])),
    worktree: sanitizeValue(repo.path),
    githubRepo: repo.githubRepo,
  };
}

function readLedgerEntries(repo) {
  if (!existsSync(repo.ledgerPath)) {
    return [];
  }

  const content = sanitizeValue(readFileSync(repo.ledgerPath, 'utf8'));
  const matches = [...content.matchAll(/^## (\d{4}-\d{2}-\d{2}) - (SEC-\d+) - (.+)$/gm)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? content.length;
    const body = content.slice(start, end).trim();
    return {
      repo: repo.key,
      repoName: repo.name,
      path: sanitizeValue(repo.ledgerPath),
      date: match[1],
      issue: match[2],
      title: match[3],
      body,
      summary: summarizeLedgerEntry(body),
      prUrl: findFirstUrl(body, /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/),
      checks: findBulletValue(body, 'Checks'),
      deployment: findBulletValue(body, 'Deployment'),
      blockers: findBulletValue(body, 'Blockers'),
      followUps: findBulletValue(body, 'Follow-ups'),
    };
  });
}

function buildIssueRow(issueKey, linearSnapshot, repoStates, ledgerEntries) {
  const issue = linearSnapshot.get(issueKey);
  const matchingEntries = ledgerEntries.filter((entry) => entry.issue === issueKey);
  const latestLedger = matchingEntries[0] || null;
  const repoScope = inferRepoScope(issue, matchingEntries);
  const relevantRepos = repoStates.filter((repo) => repoScope === 'both' || repoScope === repo.repo);
  const prUrl = latestLedger?.prUrl || firstAttachmentUrl(issue, /github\.com\/.+\/pull\/\d+/);
  const prState = readPrState(prUrl);
  const blockers = [];

  if (!issue) {
    blockers.push('Linear snapshot missing; issue title/status are unavailable in offline report.');
  }
  if (!latestLedger) {
    blockers.push('No matching run ledger entry found.');
  }
  if (prUrl && prState.status === 'Unavailable') {
    blockers.push(prState.reason);
  }

  return {
    issue: {
      key: issueKey,
      title: sanitizeValue(issue?.title || 'Unknown title'),
      url: sanitizeValue(issue?.url || ''),
      status: sanitizeValue(issue?.status || 'Unknown'),
      priority: sanitizeValue(issue?.priority?.name || issue?.priority || 'Unknown'),
      assignee: sanitizeValue(issue?.assignee || issue?.assigneeName || 'Unknown'),
      project: sanitizeValue(issue?.project || issue?.projectName || 'Unknown'),
      labels: (issue?.labels || []).map((label) => sanitizeValue(typeof label === 'string' ? label : label.name)),
    },
    phase: inferPhase(issue, prState, latestLedger),
    repoScope,
    repos: relevantRepos.map((repo) => ({
      name: repo.name,
      branch: repo.branch,
      worktree: repo.worktree,
      status: repo.status,
    })),
    pr: {
      url: sanitizeValue(prUrl || ''),
      state: prState.state,
      isDraft: prState.isDraft,
      mergeable: prState.mergeable,
      reviewDecision: prState.reviewDecision,
      checks: prState.checks,
    },
    checks: latestLedger?.checks || 'No ledger check record found.',
    deployment: latestLedger?.deployment || 'No deployment recorded for this issue.',
    ledger: latestLedger
      ? {
          repo: latestLedger.repoName,
          path: latestLedger.path,
          date: latestLedger.date,
          summary: latestLedger.summary,
          blockers: latestLedger.blockers,
          followUps: latestLedger.followUps,
        }
      : null,
    risks: blockers.concat(latestLedger?.blockers && latestLedger.blockers !== 'None.' ? [latestLedger.blockers] : []),
    humanAction: inferHumanAction(issue, prState, latestLedger, blockers),
  };
}

function readPrState(prUrl) {
  if (!prUrl) {
    return {
      status: 'Not linked',
      state: 'No PR',
      isDraft: null,
      mergeable: null,
      reviewDecision: null,
      checks: [],
    };
  }

  const parsed = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!parsed) {
    return {
      status: 'Unavailable',
      state: 'Unknown',
      reason: 'PR URL could not be parsed.',
      isDraft: null,
      mergeable: null,
      reviewDecision: null,
      checks: [],
    };
  }

  try {
    const raw = execFileSync(
      'gh',
      [
        'pr',
        'view',
        parsed[2],
        '--repo',
        parsed[1],
        '--json',
        'state,isDraft,mergeable,reviewDecision,statusCheckRollup,url',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const info = JSON.parse(raw);
    return {
      status: 'Available',
      state: info.state || 'Unknown',
      isDraft: Boolean(info.isDraft),
      mergeable: info.mergeable || 'Unknown',
      reviewDecision: info.reviewDecision || 'None',
      checks: summarizeChecks(info.statusCheckRollup || []),
    };
  } catch (error) {
    return {
      status: 'Unavailable',
      state: 'Unknown',
      reason: `Unable to read PR with gh CLI: ${error.message}`,
      isDraft: null,
      mergeable: null,
      reviewDecision: null,
      checks: [],
    };
  }
}

function readLiveDeployments() {
  try {
    const raw = execFileSync('npx', ['@railway/cli', 'service', 'list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30000,
    });
    return {
      provider: 'Railway',
      status: 'Available',
      summary: sanitizeValue(raw)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && /status:|deployment ID:|secondop-backend|Postgres|url:/.test(line)),
    };
  } catch (error) {
    return {
      provider: 'Railway',
      status: 'Unavailable',
      summary: [],
      blocker: `Unable to read Railway service list: ${error.message}`,
    };
  }
}

function skippedDeploymentStatus() {
  return {
    provider: 'Railway/Vercel',
    status: 'Skipped',
    summary: ['Live deployment polling skipped. Pass --live-deploys from an authenticated operator machine.'],
  };
}

function buildStatusCards(issueRows) {
  return {
    needsHumanApproval: issueRows.filter((row) => /human|review|merge|approval/i.test(row.humanAction)).length,
    blocked: issueRows.filter((row) => row.risks.length > 0).length,
    inFlight: issueRows.filter((row) => /coding|checks|progress/i.test(row.phase)).length,
    recentlyDeployed: issueRows.filter((row) => /deployed|production/i.test(row.deployment)).length,
    missingGuardrails: issueRows.filter((row) => /missing|unavailable|No .*found/i.test(row.risks.join(' '))).length,
  };
}

function collectBlockers(issueRows, deployments) {
  const rowBlockers = issueRows.flatMap((row) =>
    row.risks.map((risk) => `${row.issue.key}: ${risk}`)
  );
  if (deployments.blocker) {
    rowBlockers.push(deployments.blocker);
  }
  return rowBlockers;
}

function renderMarkdown(data) {
  const rows = data.rows
    .map(
      (row) => `| ${escapeTable(row.issue.key)} | ${escapeTable(row.issue.title)} | ${escapeTable(
        row.issue.status
      )} | ${escapeTable(row.phase)} | ${escapeTable(row.repoScope)} | ${escapeTable(
        row.pr.state
      )} | ${escapeTable(row.checks)} | ${escapeTable(row.deployment)} | ${escapeTable(row.humanAction)} |`
    )
    .join('\n');

  const ledgerDetails = data.rows
    .map((row) => {
      const ledger = row.ledger;
      if (!ledger) {
        return `### ${row.issue.key}\n\nNo matching sanitized ledger entry found.`;
      }
      return `### ${row.issue.key}\n\n- Ledger: ${ledger.path}\n- Repo: ${ledger.repo}\n- Date: ${ledger.date}\n- Summary: ${ledger.summary}\n- Blockers: ${ledger.blockers || 'None recorded.'}\n- Follow-ups: ${ledger.followUps || 'None recorded.'}`;
    })
    .join('\n\n');

  return `# SecondOp Command Center Report

Generated: ${data.generatedAt}

Workspace: ${data.workspaceRoot}

## Status Cards

- Needs human approval: ${data.statusCards.needsHumanApproval}
- Blocked or missing data: ${data.statusCards.blocked}
- In flight: ${data.statusCards.inFlight}
- Recently deployed: ${data.statusCards.recentlyDeployed}
- Missing guardrails/data: ${data.statusCards.missingGuardrails}

## Work Items

| Issue | Title | Linear status | Phase | Repo scope | PR state | Checks | Deployment | Human action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

## Deployment Snapshot

- Provider: ${data.deployments.provider}
- Status: ${data.deployments.status}
${data.deployments.summary.map((line) => `- ${line}`).join('\n')}

## Ledger Details

${ledgerDetails}

## Blockers And Missing Data

${data.blockers.length > 0 ? data.blockers.map((blocker) => `- ${blocker}`).join('\n') : '- None recorded.'}

## Safety Notes

- This report is generated locally and is not committed by default.
- Sanitization redacts token-shaped values, private environment assignments, and credential-bearing URLs.
- Do not paste raw provider responses, auth URLs, secrets, patient data, payment data, or private logs into Linear snapshots or run ledgers.
`;
}

function inferRepoScope(issue, entries) {
  const labels = (issue?.labels || []).map((label) =>
    String(typeof label === 'string' ? label : label.name).toLowerCase()
  );
  if (labels.includes('frontend')) return 'frontend';
  if (labels.includes('backend')) return 'backend';
  const repos = new Set(entries.map((entry) => entry.repo));
  if (repos.size > 1) return 'both';
  if (repos.size === 1) return [...repos][0];
  return 'both';
}

function inferPhase(issue, prState, ledger) {
  const status = String(issue?.status || '').toLowerCase();
  if (status === 'done') return 'done';
  if (prState.state === 'MERGED' && /production|deployed/i.test(ledger?.deployment || '')) return 'deployed';
  if (prState.state === 'OPEN') return prState.isDraft ? 'PR review - draft' : 'PR review';
  if (status.includes('progress')) return 'coding/checks';
  if (status.includes('review')) return 'PR review';
  if (status.includes('todo')) return 'ready for code';
  if (status.includes('backlog')) return 'spec/backlog';
  return 'unknown';
}

function inferHumanAction(issue, prState, ledger, blockers) {
  if (blockers.length > 0) {
    return 'Review missing data/blockers.';
  }
  if (prState.state === 'OPEN' && !prState.isDraft) {
    return 'Human review/merge approval needed.';
  }
  if (prState.state === 'OPEN' && prState.isDraft) {
    return 'Agent should finish PR before human merge approval.';
  }
  if (String(issue?.status || '').toLowerCase() === 'done') {
    return 'None.';
  }
  if (ledger?.followUps) {
    return ledger.followUps;
  }
  return 'Agent continues implementation.';
}

function summarizeGitStatus(status) {
  if (!status) return 'Unknown';
  const lines = status.split('\n').filter(Boolean);
  const changed = lines.filter((line) => !line.startsWith('##')).length;
  const branch = lines.find((line) => line.startsWith('##')) || '';
  return changed === 0 ? `${branch}; clean` : `${branch}; ${changed} changed/untracked item(s)`;
}

function summarizeLedgerEntry(entryBody) {
  const status = findBulletValue(entryBody, 'Status') || 'No status';
  const verification = findBulletValue(entryBody, 'Verification') || 'No verification recorded';
  return `${status} ${verification}`;
}

function summarizeChecks(checks) {
  return checks.map((check) => ({
    name: check.name || check.context || 'Unnamed check',
    status: check.status || check.state || 'Unknown',
    conclusion: check.conclusion || 'Unknown',
  }));
}

function runGit(cwd, gitArgs) {
  try {
    return execFileSync('git', gitArgs, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function commandAvailable(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findBulletValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^- ${escaped}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

function findFirstUrl(text, regex) {
  const match = text.match(regex);
  return match ? match[0] : '';
}

function firstAttachmentUrl(issue, regex) {
  const attachments = issue?.attachments || issue?.links || [];
  const match = attachments.find((attachment) => regex.test(attachment.url || ''));
  return match?.url || '';
}

function escapeTable(value) {
  return sanitizeValue(String(value ?? '')).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function sanitizeValue(value) {
  return String(value ?? '')
    .replace(/\b(gho|ghp|github_pat|sk|rk|vercel|railway)_[A-Za-z0-9_=-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, '$1 [REDACTED_TOKEN]')
    .replace(/\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE|KEY|DATABASE_URL|DB_URL)[A-Z0-9_]*)=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/https?:\/\/[^\s]+(?:token|code|state|auth|password|secret|key)=[^\s)]+/gi, '[REDACTED_URL]')
    .replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, '[REDACTED_DATABASE_URL]');
}
