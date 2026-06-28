import fs from 'fs';
import path from 'path';

type ProviderName = 'linear' | 'github' | 'vercel' | 'railway' | 'ledger';
type ProviderState = 'available' | 'partial' | 'unavailable' | 'skipped';

export interface ProviderStatus {
  provider: ProviderName;
  status: ProviderState;
  message?: string;
  lastUpdatedAt?: string;
}

export interface CheckStatus {
  name: string;
  status: 'passed' | 'failed' | 'pending' | 'unknown';
  summary?: string;
}

export interface DeploymentStatus {
  provider: 'railway' | 'vercel' | 'none';
  target: 'local' | 'staging' | 'production' | 'unknown';
  status: 'success' | 'failed' | 'building' | 'skipped' | 'unknown';
  summary?: string;
}

export interface LedgerSummary {
  repo: 'backend' | 'frontend' | 'unknown';
  path: string;
  issueKey: string;
  title: string;
  date: string;
  summary: string;
  checks: string;
  prUrl: string;
  deployment: string;
  blockers: string;
  followUps: string;
}

export interface CommandCenterItem {
  issue: {
    key: string;
    title: string;
    url: string;
    status: string;
    priority: 'Urgent' | 'High' | 'Medium' | 'Low' | 'None' | 'Unknown';
    assignee?: string;
    project?: string;
    labels: string[];
  };
  phase:
    | 'spec_needed'
    | 'ready_for_code'
    | 'coding'
    | 'checks'
    | 'pr_review'
    | 'merge_approval'
    | 'deployed'
    | 'blocked'
    | 'done';
  repoScope: 'frontend' | 'backend' | 'both' | 'workflow_only' | 'unknown';
  branch?: string;
  worktree?: string;
  pr?: {
    url: string;
    state: 'draft' | 'ready' | 'merged' | 'closed' | 'unknown';
    mergeable?: 'mergeable' | 'conflicting' | 'unknown';
    reviewDecision?: 'approved' | 'changes_requested' | 'review_required' | 'unknown';
    checks: CheckStatus[];
  };
  checks: CheckStatus[];
  deployment?: DeploymentStatus;
  ledger?: LedgerSummary;
  risks: string[];
  humanAction: string;
}

export interface CommandCenterAgentLane {
  role:
    | 'product_spec'
    | 'coding'
    | 'pr_review'
    | 'qa_smoke'
    | 'release_deploy'
    | 'command_center';
  label: string;
  status: 'active' | 'waiting_for_human' | 'blocked' | 'idle';
  currentFocus: string;
  lastActivityAt?: string;
  evidence: string[];
  humanGate: string;
  repoScopes: Array<CommandCenterItem['repoScope']>;
  itemCount: number;
}

export interface CommandCenterSummary {
  generatedAt: string;
  environment: 'local' | 'staging' | 'production';
  cards: {
    needsHumanApproval: number;
    blocked: number;
    inFlight: number;
    recentlyDeployed: number;
    missingGuardrails: number;
  };
  items: CommandCenterItem[];
  agents: CommandCenterAgentLane[];
  providerStatus: ProviderStatus[];
  audit: {
    requestId?: string;
    generatedByUserId: string;
    redactionVersion: string;
  };
}

interface LedgerSource {
  repo: 'backend' | 'frontend';
  path: string;
}

const REDACTION_VERSION = 'command-center-redaction-v1';

export const sanitizeCommandCenterText = (value: unknown): string => {
  return String(value ?? '')
    .replace(/\b(gho|ghp|github_pat|sk|rk|vercel|railway)_[A-Za-z0-9_=-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, '$1 [REDACTED_TOKEN]')
    .replace(/\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE|KEY|DATABASE_URL|DB_URL)[A-Z0-9_]*)=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/https?:\/\/[^\s]+(?:token|code|state|auth|password|secret|key)=[^\s)]+/gi, '[REDACTED_URL]')
    .replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, '[REDACTED_DATABASE_URL]');
};

export const getCommandCenterSummary = (params: {
  requestId?: string;
  userId: string;
}): CommandCenterSummary => {
  const ledgers = getLatestLedgerEntries();
  const items = ledgers.map(buildItemFromLedger);
  const providerStatus = buildProviderStatus(ledgers);
  const agents = buildAgentLanes(items, ledgers);

  return {
    generatedAt: new Date().toISOString(),
    environment: resolveEnvironment(),
    cards: {
      needsHumanApproval: items.filter((item) => /review|approval/i.test(item.humanAction)).length,
      blocked: items.filter((item) => item.risks.length > 0).length,
      inFlight: items.filter((item) => item.phase === 'coding' || item.phase === 'checks').length,
      recentlyDeployed: items.filter((item) => item.phase === 'deployed').length,
      missingGuardrails: providerStatus.filter((status) => status.status !== 'available').length,
    },
    items,
    agents,
    providerStatus,
    audit: {
      requestId: params.requestId,
      generatedByUserId: params.userId,
      redactionVersion: REDACTION_VERSION,
    },
  };
};

export const getCommandCenterItems = (): CommandCenterItem[] => {
  return getLatestLedgerEntries().map(buildItemFromLedger);
};

export const getCommandCenterItem = (issueKey: string): CommandCenterItem | null => {
  return getCommandCenterItems().find((item) => item.issue.key.toLowerCase() === issueKey.toLowerCase()) || null;
};

export const getLatestLedgerEntries = (): LedgerSummary[] => {
  return getLedgerSources().flatMap(readLedgerSource);
};

export const getCommandCenterDeployments = (): DeploymentStatus[] => {
  return getLatestLedgerEntries()
    .map((ledger) => parseDeploymentStatus(ledger.deployment))
    .filter((deployment) => deployment.provider !== 'none');
};

const resolveEnvironment = (): 'local' | 'staging' | 'production' => {
  if (process.env.NODE_ENV === 'production') {
    return 'production';
  }
  if (process.env.NODE_ENV === 'test') {
    return 'local';
  }
  return process.env.APP_ENV === 'staging' ? 'staging' : 'local';
};

const getLedgerSources = (): LedgerSource[] => {
  const backendLedgerPath = process.env.COMMAND_CENTER_BACKEND_LEDGER_PATH || path.resolve(process.cwd(), 'docs/AGENT_RUN_LEDGER.md');
  const frontendLedgerPath = process.env.COMMAND_CENTER_FRONTEND_LEDGER_PATH;
  const sources: LedgerSource[] = [{ repo: 'backend', path: backendLedgerPath }];

  if (frontendLedgerPath) {
    sources.push({ repo: 'frontend', path: frontendLedgerPath });
  }

  return sources;
};

const readLedgerSource = (source: LedgerSource): LedgerSummary[] => {
  if (!fs.existsSync(source.path)) {
    return [];
  }

  const content = sanitizeCommandCenterText(fs.readFileSync(source.path, 'utf8'));
  const matches = [...content.matchAll(/^## (\d{4}-\d{2}-\d{2}) - (SEC-\d+) - (.+)$/gm)];

  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? content.length;
    const body = content.slice(start, end).trim();

    return {
      repo: source.repo,
      path: sanitizeCommandCenterText(source.path),
      date: match[1],
      issueKey: match[2],
      title: sanitizeCommandCenterText(match[3]),
      summary: `${readBullet(body, 'Status') || 'Unknown status'} ${readBullet(body, 'Verification') || ''}`.trim(),
      checks: readBullet(body, 'Checks') || 'No checks recorded.',
      prUrl: normalizeUrl(readBullet(body, 'PR')),
      deployment: readBullet(body, 'Deployment') || 'No deployment recorded.',
      blockers: readBullet(body, 'Blockers') || 'None recorded.',
      followUps: readBullet(body, 'Follow-ups') || 'None recorded.',
    };
  });
};

const buildItemFromLedger = (ledger: LedgerSummary): CommandCenterItem => {
  const prUrl = ledger.prUrl;
  const deployment = parseDeploymentStatus(ledger.deployment);
  const blockers = ledger.blockers && !/^none\.?$/i.test(ledger.blockers) ? [ledger.blockers] : [];

  return {
    issue: {
      key: ledger.issueKey,
      title: ledger.title,
      url: '',
      status: inferIssueStatus(ledger),
      priority: 'Unknown',
      labels: [],
    },
    phase: inferPhase(ledger, deployment),
    repoScope: ledger.repo === 'unknown' ? 'unknown' : ledger.repo,
    pr: prUrl
      ? {
          url: prUrl,
          state: prUrl.includes('/pull/') ? 'unknown' : 'unknown',
          mergeable: 'unknown',
          reviewDecision: 'unknown',
          checks: parseChecks(ledger.checks),
        }
      : undefined,
    checks: parseChecks(ledger.checks),
    deployment,
    ledger,
    risks: blockers,
    humanAction: inferHumanAction(ledger, prUrl, blockers),
  };
};

const buildProviderStatus = (ledgers: LedgerSummary[]): ProviderStatus[] => {
  const now = new Date().toISOString();
  return [
    {
      provider: 'ledger',
      status: ledgers.length > 0 ? 'available' : 'unavailable',
      message: ledgers.length > 0 ? 'Read sanitized run ledger entries.' : 'No ledger entries were found from allowlisted paths.',
      lastUpdatedAt: now,
    },
    {
      provider: 'linear',
      status: 'skipped',
      message: 'Live Linear API integration is not configured in this backend slice.',
    },
    {
      provider: 'github',
      status: 'skipped',
      message: 'Live GitHub API integration is not configured in this backend slice.',
    },
    {
      provider: 'vercel',
      status: 'skipped',
      message: 'Live Vercel API integration is not configured in this backend slice.',
    },
    {
      provider: 'railway',
      status: 'skipped',
      message: 'Live Railway API integration is not configured in this backend slice.',
    },
  ];
};

const buildAgentLanes = (
  items: CommandCenterItem[],
  ledgers: LedgerSummary[]
): CommandCenterAgentLane[] => {
  const latestLedger = [...ledgers].sort((left, right) => right.date.localeCompare(left.date))[0];
  const codingItems = items.filter((item) => item.phase === 'coding' || item.phase === 'checks');
  const reviewItems = items.filter((item) => item.phase === 'pr_review' || Boolean(item.pr));
  const blockedItems = items.filter((item) => item.risks.length > 0 || item.phase === 'blocked');
  const deployedItems = items.filter((item) => item.phase === 'deployed' || item.deployment?.status === 'success');
  const readyItems = items.filter((item) => item.phase === 'ready_for_code' || item.phase === 'spec_needed');
  const checkedItems = items.filter((item) => item.checks.some((check) => check.status === 'passed' || check.status === 'failed'));

  return [
    createAgentLane({
      role: 'product_spec',
      label: 'Product/spec agent',
      items: readyItems,
      fallbackLedger: latestLedger,
      idleFocus: 'No spec work is currently inferred from the run ledger.',
      humanGate: 'Human owns requirement priority and acceptance criteria approval.',
      activeStatus: readyItems.length > 0 ? 'active' : 'idle',
    }),
    createAgentLane({
      role: 'coding',
      label: 'Coding agent',
      items: codingItems,
      fallbackLedger: latestLedger,
      idleFocus: 'No active coding or local-check work is inferred.',
      humanGate: 'May implement through PR readiness; merge and deploy stay human-gated.',
      activeStatus: blockedItems.length > 0 ? 'blocked' : codingItems.length > 0 ? 'active' : 'idle',
    }),
    createAgentLane({
      role: 'pr_review',
      label: 'PR review agent',
      items: reviewItems,
      fallbackLedger: latestLedger,
      idleFocus: 'No PR review queue is inferred.',
      humanGate: 'Human decides merge approval after review signals are ready.',
      activeStatus: reviewItems.length > 0 ? 'waiting_for_human' : 'idle',
    }),
    createAgentLane({
      role: 'qa_smoke',
      label: 'QA/smoke-test agent',
      items: checkedItems,
      fallbackLedger: latestLedger,
      idleFocus: 'No recent smoke-test or check evidence is inferred.',
      humanGate: 'Human reviews failed or missing smoke evidence before release.',
      activeStatus: checkedItems.some((item) => item.checks.some((check) => check.status === 'failed')) ? 'blocked' : checkedItems.length > 0 ? 'active' : 'idle',
    }),
    createAgentLane({
      role: 'release_deploy',
      label: 'Release/deploy agent',
      items: deployedItems,
      fallbackLedger: latestLedger,
      idleFocus: 'No recent deployment lane activity is inferred.',
      humanGate: 'Human approval is required before production deploys or rollback actions.',
      activeStatus: deployedItems.length > 0 ? 'waiting_for_human' : 'idle',
    }),
    createAgentLane({
      role: 'command_center',
      label: 'Command-center/status agent',
      items,
      fallbackLedger: latestLedger,
      idleFocus: 'No command-center source data is available.',
      humanGate: 'Human resolves ambiguous status, stale ledgers, and provider-access gaps.',
      activeStatus: ledgers.length > 0 ? 'active' : 'blocked',
    }),
  ];
};

const createAgentLane = (params: {
  role: CommandCenterAgentLane['role'];
  label: string;
  items: CommandCenterItem[];
  fallbackLedger?: LedgerSummary;
  idleFocus: string;
  humanGate: string;
  activeStatus: CommandCenterAgentLane['status'];
}): CommandCenterAgentLane => {
  const focusItem = params.items[0];
  const focusLedger = focusItem?.ledger || params.fallbackLedger;
  const evidence = params.items
    .slice(0, 3)
    .map((item) => `${item.issue.key}: ${item.humanAction || item.issue.status}`)
    .filter(Boolean);

  if (evidence.length === 0 && focusLedger) {
    evidence.push(`${focusLedger.issueKey}: ${focusLedger.summary || focusLedger.title}`);
  }

  return {
    role: params.role,
    label: params.label,
    status: params.activeStatus,
    currentFocus: focusItem
      ? `${focusItem.issue.key} - ${focusItem.issue.title}`
      : params.idleFocus,
    lastActivityAt: focusLedger?.date,
    evidence,
    humanGate: params.humanGate,
    repoScopes: uniqueRepoScopes(params.items),
    itemCount: params.items.length,
  };
};

const uniqueRepoScopes = (items: CommandCenterItem[]): Array<CommandCenterItem['repoScope']> => {
  const scopes = [...new Set(items.map((item) => item.repoScope))];
  return scopes.length > 0 ? scopes : ['unknown'];
};

const readBullet = (entry: string, label: string): string => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = entry.match(new RegExp(`^- ${escaped}:\\s*(.+)$`, 'im'));
  return sanitizeCommandCenterText(match?.[1] || '');
};

const normalizeUrl = (value: string): string => value.replace(/[.)]+$/g, '');

const inferIssueStatus = (ledger: LedgerSummary): string => {
  const status = ledger.summary.split('.')[0].trim();
  return status || 'Unknown';
};

const inferPhase = (ledger: LedgerSummary, deployment: DeploymentStatus): CommandCenterItem['phase'] => {
  if (/done/i.test(ledger.summary)) {
    return 'done';
  }
  if (deployment.status === 'success' && deployment.target === 'production') {
    return 'deployed';
  }
  if (/review|approval/i.test(ledger.followUps)) {
    return 'pr_review';
  }
  if (/passed/i.test(ledger.checks)) {
    return 'checks';
  }
  if (/pending/i.test(ledger.checks)) {
    return 'coding';
  }
  if (!/^none/i.test(ledger.blockers)) {
    return 'blocked';
  }
  return 'ready_for_code';
};

const parseChecks = (checks: string): CheckStatus[] => {
  if (!checks || /no checks recorded/i.test(checks)) {
    return [{ name: 'checks', status: 'unknown', summary: checks || 'No checks recorded.' }];
  }

  return checks
    .split(';')
    .map((check) => check.trim())
    .filter(Boolean)
    .map((check) => ({
      name: check.split(' ')[0].replace(/`/g, '') || 'check',
      status: /passed/i.test(check) ? 'passed' : /failed/i.test(check) ? 'failed' : /pending/i.test(check) ? 'pending' : 'unknown',
      summary: check,
    }));
};

const parseDeploymentStatus = (deployment: string): DeploymentStatus => {
  if (!deployment || /none|not applicable|no deployment/i.test(deployment)) {
    return { provider: 'none', target: 'unknown', status: 'skipped', summary: deployment || 'No deployment recorded.' };
  }

  return {
    provider: /vercel/i.test(deployment) ? 'vercel' : /railway|backend/i.test(deployment) ? 'railway' : 'none',
    target: /production/i.test(deployment) ? 'production' : /staging/i.test(deployment) ? 'staging' : 'unknown',
    status: /success|passed|online|deployed/i.test(deployment) ? 'success' : /failed/i.test(deployment) ? 'failed' : /building/i.test(deployment) ? 'building' : 'unknown',
    summary: deployment,
  };
};

const inferHumanAction = (ledger: LedgerSummary, prUrl: string, blockers: string[]): string => {
  if (blockers.length > 0) {
    return 'Review blockers before merge or deploy.';
  }
  if (/wait for human/i.test(ledger.followUps)) {
    return ledger.followUps;
  }
  if (prUrl) {
    return 'Review PR and decide merge approval.';
  }
  return ledger.followUps || 'No human action recorded.';
};
