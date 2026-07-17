import {
  getConfiguredServiceHealthTargets,
  getServiceHealthReport,
  resolveLocalEnvironment,
} from '../services/serviceHealth.service';
import { query } from '../database/connection';
import { getPresidioStatus } from '../services/presidioHealth.service';
import { getAiGatewayStatus } from '../services/aiGatewayStatus.service';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../services/presidioHealth.service', () => ({
  getPresidioStatus: jest.fn(),
}));

jest.mock('../services/aiGatewayStatus.service', () => ({
  getAiGatewayStatus: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedPresidioStatus = getPresidioStatus as jest.MockedFunction<typeof getPresidioStatus>;
const mockedAiGatewayStatus = getAiGatewayStatus as jest.MockedFunction<typeof getAiGatewayStatus>;

const originalEnv = process.env;
const originalFetch = global.fetch;

describe('serviceHealth.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      SERVICE_HEALTH_TARGETS: undefined,
      SECONDOP_DEPLOY_ENV: 'test',
      DEID_ENABLED: 'false',
      PHOENIX_ENABLED: 'false',
      DB_HOST: 'db.example',
      ANALYSIS_QUEUE_SCHEMA: 'pgboss',
    };

    mockedQuery.mockImplementation(async (text: string) => {
      if (text.includes('information_schema.schemata')) {
        return { rows: [{ present: true }] } as any;
      }
      return { rows: [{ ok: 1 }] } as any;
    });

    mockedPresidioStatus.mockResolvedValue({
      enabled: false,
      reversibleKeyConfigured: false,
      analyzerUrlHost: null,
      anonymizerUrlHost: null,
      probes: [
        { service: 'analyzer', status: 'skipped' },
        { service: 'anonymizer', status: 'skipped' },
      ],
      ready: false,
    });

    mockedAiGatewayStatus.mockResolvedValue({
      mode: 'direct',
      configured: true,
      redactedBaseUrlHost: null,
      approvedModelAliases: [],
      configuredModelAliases: [],
      probe: { attempted: false, status: 'skipped' },
      lastError: null,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('uses built-in defaults when SERVICE_HEALTH_TARGETS is unset', () => {
    const targets = getConfiguredServiceHealthTargets();
    expect(targets.production.some((item) => item.id === 'api')).toBe(true);
    expect(targets.staging.some((item) => item.id === 'api')).toBe(true);
  });

  it('parses SERVICE_HEALTH_TARGETS JSON overrides', () => {
    process.env.SERVICE_HEALTH_TARGETS = JSON.stringify({
      production: [
        {
          id: 'fe',
          label: 'Frontend',
          url: 'https://example.com',
          probe: 'http',
        },
      ],
      staging: [
        {
          id: 'api',
          label: 'Backend API',
          url: 'https://staging.example.com',
          probe: 'backend_health',
        },
      ],
    });

    const targets = getConfiguredServiceHealthTargets();
    expect(targets.production).toHaveLength(1);
    expect(targets.production[0].url).toBe('https://example.com');
    expect(targets.staging[0].probe).toBe('backend_health');
  });

  it('resolves local environment from SECONDOP_DEPLOY_ENV', () => {
    process.env.SECONDOP_DEPLOY_ENV = 'Staging';
    expect(resolveLocalEnvironment()).toBe('staging');
  });

  it('reports up/down/degraded from remote probes and local deps', async () => {
    process.env.SERVICE_HEALTH_TARGETS = JSON.stringify({
      production: [
        {
          id: 'api',
          label: 'Backend API',
          url: 'https://prod-api.example',
          probe: 'backend_health',
        },
        {
          id: 'fe',
          label: 'Frontend',
          url: 'https://prod-fe.example',
          probe: 'http',
        },
      ],
      staging: [
        {
          id: 'fe',
          label: 'Frontend',
          url: 'https://staging-fe.example',
          probe: 'http',
        },
        {
          id: 'broken',
          label: 'Broken',
          url: 'https://down.example',
          probe: 'http',
        },
      ],
    });

    global.fetch = jest.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === 'https://prod-api.example/health') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ status: 'ok' }),
        } as unknown as Response;
      }

      if (url === 'https://prod-fe.example') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
        } as unknown as Response;
      }

      if (url === 'https://staging-fe.example') {
        return {
          ok: false,
          status: 302,
          headers: {
            get: (name: string) => (name === 'location' ? 'https://vercel.com/login' : null),
          },
        } as unknown as Response;
      }

      throw new Error('fetch failed');
    }) as typeof fetch;

    const report = await getServiceHealthReport();
    const production = report.environments.find((env) => env.name === 'production')!;
    const staging = report.environments.find((env) => env.name === 'staging')!;

    expect(production.services.find((row) => row.id === 'api')?.status).toBe('up');
    expect(production.services.find((row) => row.id === 'fe')?.status).toBe('up');
    expect(staging.services.find((row) => row.id === 'fe')?.status).toBe('degraded');
    expect(staging.services.find((row) => row.id === 'broken')?.status).toBe('down');
    expect(report.local.find((row) => row.id === 'postgres')?.status).toBe('up');
    expect(report.local.find((row) => row.id === 'analysis_queue')?.status).toBe('up');
    expect(report.local.find((row) => row.id === 'presidio_local')?.status).toBe('skipped');
  });

  it('marks backend health down when /health payload is unexpected', async () => {
    process.env.SERVICE_HEALTH_TARGETS = JSON.stringify({
      production: [
        {
          id: 'api',
          label: 'Backend API',
          url: 'https://prod-api.example',
          probe: 'backend_health',
        },
      ],
      staging: [],
    });

    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ status: 'nope' }),
      } as unknown as Response;
    }) as typeof fetch;

    const report = await getServiceHealthReport();
    expect(report.environments[0].services[0].status).toBe('down');
    expect(report.environments[0].services[0].detail).toMatch(/Unexpected/);
  });
});
