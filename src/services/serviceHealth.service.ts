import { query } from '../database/connection';
import { getAiGatewayStatus } from './aiGatewayStatus.service';
import { getPresidioStatus } from './presidioHealth.service';

export type ServiceHealthStatus = 'up' | 'down' | 'degraded' | 'skipped';
export type ServiceHealthProbe =
  | 'http'
  | 'backend_health'
  | 'presidio_health';

export interface ServiceHealthTarget {
  id: string;
  label: string;
  url: string;
  probe: ServiceHealthProbe;
}

export interface ServiceHealthRow {
  id: string;
  label: string;
  environment: 'production' | 'staging' | 'local';
  status: ServiceHealthStatus;
  host: string | null;
  latencyMs?: number;
  detail?: string;
  statusCode?: number;
}

export interface ServiceHealthEnvironmentReport {
  name: 'production' | 'staging';
  services: ServiceHealthRow[];
}

export interface ServiceHealthReport {
  checkedAt: string;
  localEnvironment: string;
  environments: ServiceHealthEnvironmentReport[];
  local: ServiceHealthRow[];
}

const PROBE_TIMEOUT_MS = 3000;

const DEFAULT_PRODUCTION_TARGETS: ServiceHealthTarget[] = [
  {
    id: 'fe',
    label: 'Frontend',
    url: 'https://secondop.in',
    probe: 'http',
  },
  {
    id: 'api',
    label: 'Backend API',
    url: 'https://secondop-backend-production.up.railway.app',
    probe: 'backend_health',
  },
  {
    id: 'presidio_analyzer',
    label: 'Presidio Analyzer',
    url: 'https://secondop-presidio-analyzer-production.up.railway.app',
    probe: 'presidio_health',
  },
  {
    id: 'presidio_anonymizer',
    label: 'Presidio Anonymizer',
    url: 'https://secondop-presidio-anonymizer-production.up.railway.app',
    probe: 'presidio_health',
  },
  {
    id: 'phoenix',
    label: 'Phoenix',
    url: 'https://secondop-phoenix-production.up.railway.app',
    probe: 'http',
  },
];

const DEFAULT_STAGING_TARGETS: ServiceHealthTarget[] = [
  {
    id: 'api',
    label: 'Backend API',
    url: 'https://secondop-backend-staging-staging.up.railway.app',
    probe: 'backend_health',
  },
];

const redactHost = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

const parseBoolean = (value: string | undefined): boolean => {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const isValidProbe = (value: unknown): value is ServiceHealthProbe =>
  value === 'http' || value === 'backend_health' || value === 'presidio_health';

const normalizeTarget = (raw: unknown): ServiceHealthTarget | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
  const probe = candidate.probe;

  if (!id || !label || !url || !isValidProbe(probe)) {
    return null;
  }

  try {
    // Validate URL shape early so bad config fails closed as "down" at probe time.
    new URL(url);
  } catch {
    return null;
  }

  return { id, label, url: url.replace(/\/$/, ''), probe };
};

const parseTargetsList = (value: unknown, fallback: ServiceHealthTarget[]): ServiceHealthTarget[] => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const parsed = value
    .map((item) => normalizeTarget(item))
    .filter((item): item is ServiceHealthTarget => Boolean(item));

  return parsed.length > 0 ? parsed : fallback;
};

export const getConfiguredServiceHealthTargets = (): {
  production: ServiceHealthTarget[];
  staging: ServiceHealthTarget[];
} => {
  const raw = process.env.SERVICE_HEALTH_TARGETS?.trim();
  if (!raw) {
    return {
      production: DEFAULT_PRODUCTION_TARGETS,
      staging: DEFAULT_STAGING_TARGETS,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      production: parseTargetsList(parsed.production, DEFAULT_PRODUCTION_TARGETS),
      staging: parseTargetsList(parsed.staging, DEFAULT_STAGING_TARGETS),
    };
  } catch {
    return {
      production: DEFAULT_PRODUCTION_TARGETS,
      staging: DEFAULT_STAGING_TARGETS,
    };
  }
};

export const resolveLocalEnvironment = (): string => {
  const explicit =
    process.env.SECONDOP_DEPLOY_ENV?.trim() ||
    process.env.RAILWAY_ENVIRONMENT_NAME?.trim() ||
    '';
  if (explicit) {
    return explicit.toLowerCase();
  }

  return (process.env.NODE_ENV || 'development').toLowerCase();
};

const looksLikeAuthGate = (statusCode: number, locationHeader: string | null): boolean => {
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }

  if (statusCode !== 302 && statusCode !== 303 && statusCode !== 307 && statusCode !== 308) {
    return false;
  }

  const location = (locationHeader || '').toLowerCase();
  return (
    location.includes('login') ||
    location.includes('sso') ||
    location.includes('vercel.com/login') ||
    location.includes('oauth')
  );
};

const fetchWithTimeout = async (
  url: string,
  init?: RequestInit
): Promise<{ response: Response; latencyMs: number }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    });
    return { response, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
};

const probeHttp = async (
  environment: 'production' | 'staging',
  target: ServiceHealthTarget
): Promise<ServiceHealthRow> => {
  const host = redactHost(target.url);

  try {
    const { response, latencyMs } = await fetchWithTimeout(target.url, { method: 'GET' });
    const location = response.headers.get('location');

    if (response.status >= 200 && response.status < 400) {
      if (looksLikeAuthGate(response.status, location)) {
        return {
          id: target.id,
          label: target.label,
          environment,
          status: 'degraded',
          host,
          latencyMs,
          statusCode: response.status,
          detail: 'Reachable but behind an auth/SSO gate',
        };
      }

      return {
        id: target.id,
        label: target.label,
        environment,
        status: 'up',
        host,
        latencyMs,
        statusCode: response.status,
      };
    }

    if (looksLikeAuthGate(response.status, location)) {
      return {
        id: target.id,
        label: target.label,
        environment,
        status: 'degraded',
        host,
        latencyMs,
        statusCode: response.status,
        detail: 'Reachable but behind an auth/SSO gate',
      };
    }

    return {
      id: target.id,
      label: target.label,
      environment,
      status: 'down',
      host,
      latencyMs,
      statusCode: response.status,
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      id: target.id,
      label: target.label,
      environment,
      status: 'down',
      host,
      detail: error instanceof Error ? error.message : 'HTTP probe failed',
    };
  }
};

const probeBackendHealth = async (
  environment: 'production' | 'staging',
  target: ServiceHealthTarget
): Promise<ServiceHealthRow> => {
  const host = redactHost(target.url);
  const healthUrl = `${target.url.replace(/\/$/, '')}/health`;

  try {
    const { response, latencyMs } = await fetchWithTimeout(healthUrl, { method: 'GET' });
    if (!response.ok) {
      return {
        id: target.id,
        label: target.label,
        environment,
        status: 'down',
        host,
        latencyMs,
        statusCode: response.status,
        detail: `HTTP ${response.status}`,
      };
    }

    const body = (await response.json().catch(() => null)) as { status?: string } | null;
    if (body?.status !== 'ok') {
      return {
        id: target.id,
        label: target.label,
        environment,
        status: 'down',
        host,
        latencyMs,
        statusCode: response.status,
        detail: 'Unexpected /health payload',
      };
    }

    return {
      id: target.id,
      label: target.label,
      environment,
      status: 'up',
      host,
      latencyMs,
      statusCode: response.status,
      detail: 'GET /health ok',
    };
  } catch (error) {
    return {
      id: target.id,
      label: target.label,
      environment,
      status: 'down',
      host,
      detail: error instanceof Error ? error.message : 'Backend health probe failed',
    };
  }
};

const probePresidioHealth = async (
  environment: 'production' | 'staging',
  target: ServiceHealthTarget
): Promise<ServiceHealthRow> => {
  const host = redactHost(target.url);
  const healthUrl = `${target.url.replace(/\/$/, '')}/health`;

  try {
    const { response, latencyMs } = await fetchWithTimeout(healthUrl, { method: 'GET' });
    if (!response.ok) {
      return {
        id: target.id,
        label: target.label,
        environment,
        status: 'down',
        host,
        latencyMs,
        statusCode: response.status,
        detail: `HTTP ${response.status}`,
      };
    }

    return {
      id: target.id,
      label: target.label,
      environment,
      status: 'up',
      host,
      latencyMs,
      statusCode: response.status,
      detail: 'Presidio /health ok',
    };
  } catch (error) {
    return {
      id: target.id,
      label: target.label,
      environment,
      status: 'down',
      host,
      detail: error instanceof Error ? error.message : 'Presidio health probe failed',
    };
  }
};

const probeTarget = (
  environment: 'production' | 'staging',
  target: ServiceHealthTarget
): Promise<ServiceHealthRow> => {
  switch (target.probe) {
    case 'backend_health':
      return probeBackendHealth(environment, target);
    case 'presidio_health':
      return probePresidioHealth(environment, target);
    case 'http':
    default:
      return probeHttp(environment, target);
  }
};

const probeLocalDatabase = async (): Promise<ServiceHealthRow> => {
  const started = Date.now();
  try {
    await query('SELECT 1 AS ok');
    return {
      id: 'postgres',
      label: 'Postgres',
      environment: 'local',
      status: 'up',
      host: process.env.DB_HOST || 'localhost',
      latencyMs: Date.now() - started,
      detail: 'SELECT 1 ok',
    };
  } catch (error) {
    return {
      id: 'postgres',
      label: 'Postgres',
      environment: 'local',
      status: 'down',
      host: process.env.DB_HOST || 'localhost',
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : 'Database probe failed',
    };
  }
};

const probeLocalQueue = async (): Promise<ServiceHealthRow> => {
  const schema = process.env.ANALYSIS_QUEUE_SCHEMA || 'pgboss';
  const started = Date.now();

  try {
    const result = await query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.schemata
         WHERE schema_name = $1
       ) AS present`,
      [schema]
    );
    const present = Boolean(result.rows?.[0]?.present);

    if (!present) {
      return {
        id: 'analysis_queue',
        label: 'Analysis queue (pg-boss)',
        environment: 'local',
        status: 'down',
        host: process.env.DB_HOST || 'localhost',
        latencyMs: Date.now() - started,
        detail: `Schema "${schema}" not found`,
      };
    }

    return {
      id: 'analysis_queue',
      label: 'Analysis queue (pg-boss)',
      environment: 'local',
      status: 'up',
      host: process.env.DB_HOST || 'localhost',
      latencyMs: Date.now() - started,
      detail: `Schema "${schema}" present`,
    };
  } catch (error) {
    return {
      id: 'analysis_queue',
      label: 'Analysis queue (pg-boss)',
      environment: 'local',
      status: 'down',
      host: process.env.DB_HOST || 'localhost',
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : 'Queue probe failed',
    };
  }
};

const probeLocalPresidio = async (): Promise<ServiceHealthRow> => {
  const started = Date.now();
  const status = await getPresidioStatus();

  if (!status.enabled) {
    return {
      id: 'presidio_local',
      label: 'Presidio (this backend)',
      environment: 'local',
      status: 'skipped',
      host: status.analyzerUrlHost,
      latencyMs: Date.now() - started,
      detail: 'DEID_ENABLED is false',
    };
  }

  if (status.ready) {
    return {
      id: 'presidio_local',
      label: 'Presidio (this backend)',
      environment: 'local',
      status: 'up',
      host: status.analyzerUrlHost,
      latencyMs: Date.now() - started,
      detail: 'Analyzer and anonymizer ready',
    };
  }

  const failed = status.probes.filter((probe) => probe.status === 'unavailable');
  return {
    id: 'presidio_local',
    label: 'Presidio (this backend)',
    environment: 'local',
    status: 'down',
    host: status.analyzerUrlHost,
    latencyMs: Date.now() - started,
    detail: failed.map((probe) => `${probe.service}: ${probe.error || 'unavailable'}`).join('; ') ||
      'Presidio not ready',
  };
};

const probeLocalPhoenix = async (): Promise<ServiceHealthRow> => {
  const enabled = parseBoolean(process.env.PHOENIX_ENABLED);
  const collectorUrl = (process.env.PHOENIX_COLLECTOR_URL || process.env.PHOENIX_URL || '').trim();

  if (!enabled) {
    return {
      id: 'phoenix_local',
      label: 'Phoenix (this backend)',
      environment: 'local',
      status: 'skipped',
      host: collectorUrl ? redactHost(collectorUrl) : null,
      detail: 'PHOENIX_ENABLED is false',
    };
  }

  if (!collectorUrl) {
    return {
      id: 'phoenix_local',
      label: 'Phoenix (this backend)',
      environment: 'local',
      status: 'down',
      host: null,
      detail: 'PHOENIX_COLLECTOR_URL is not configured',
    };
  }

  const host = redactHost(collectorUrl);

  try {
    const { response, latencyMs } = await fetchWithTimeout(collectorUrl, { method: 'GET' });
    if (response.status >= 200 && response.status < 500) {
      // Phoenix may redirect to /login (auth on); still counts as reachable.
      return {
        id: 'phoenix_local',
        label: 'Phoenix (this backend)',
        environment: 'local',
        status: response.status >= 400 ? 'degraded' : 'up',
        host,
        latencyMs,
        statusCode: response.status,
        detail: response.status >= 400 ? 'Reachable with non-2xx response' : 'Collector reachable',
      };
    }

    return {
      id: 'phoenix_local',
      label: 'Phoenix (this backend)',
      environment: 'local',
      status: 'down',
      host,
      latencyMs,
      statusCode: response.status,
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      id: 'phoenix_local',
      label: 'Phoenix (this backend)',
      environment: 'local',
      status: 'down',
      host,
      detail: error instanceof Error ? error.message : 'Phoenix probe failed',
    };
  }
};

const probeLocalAiGateway = async (): Promise<ServiceHealthRow> => {
  const started = Date.now();
  const status = await getAiGatewayStatus();

  if (status.mode === 'direct') {
    return {
      id: 'ai_gateway',
      label: 'AI gateway',
      environment: 'local',
      status: status.configured ? 'skipped' : 'down',
      host: status.redactedBaseUrlHost,
      latencyMs: Date.now() - started,
      detail: status.configured
        ? 'Direct OpenAI mode (no live probe)'
        : 'LLM gateway / OpenAI not configured',
    };
  }

  if (status.probe.status === 'available') {
    return {
      id: 'ai_gateway',
      label: 'AI gateway',
      environment: 'local',
      status: 'up',
      host: status.redactedBaseUrlHost,
      latencyMs: Date.now() - started,
      statusCode: status.probe.statusCode,
      detail: 'LiteLLM /models ok',
    };
  }

  if (status.probe.status === 'skipped') {
    return {
      id: 'ai_gateway',
      label: 'AI gateway',
      environment: 'local',
      status: 'skipped',
      host: status.redactedBaseUrlHost,
      latencyMs: Date.now() - started,
      detail: status.probe.error || 'Probe skipped',
    };
  }

  return {
    id: 'ai_gateway',
    label: 'AI gateway',
    environment: 'local',
    status: 'down',
    host: status.redactedBaseUrlHost,
    latencyMs: Date.now() - started,
    statusCode: status.probe.statusCode,
    detail: status.probe.error || status.lastError || 'LiteLLM probe failed',
  };
};

export const getServiceHealthReport = async (): Promise<ServiceHealthReport> => {
  const targets = getConfiguredServiceHealthTargets();
  const localEnvironment = resolveLocalEnvironment();

  const [productionServices, stagingServices, local] = await Promise.all([
    Promise.all(targets.production.map((target) => probeTarget('production', target))),
    Promise.all(targets.staging.map((target) => probeTarget('staging', target))),
    Promise.all([
      probeLocalDatabase(),
      probeLocalQueue(),
      probeLocalPresidio(),
      probeLocalPhoenix(),
      probeLocalAiGateway(),
    ]),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    localEnvironment,
    environments: [
      { name: 'production', services: productionServices },
      { name: 'staging', services: stagingServices },
    ],
    local,
  };
};
