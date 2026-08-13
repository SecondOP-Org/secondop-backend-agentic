import {
  buildCutoverChecklist,
  buildOperationalLinks,
  GoldEvalRunRow,
} from '../services/goldEvalRuns.service';

const baseRun = (overrides: Partial<GoldEvalRunRow>): GoldEvalRunRow => ({
  id: 'id',
  goldSetVersion: 'gold-v0-samples',
  engine: 'baseline',
  meanCorrectness: 0.8,
  safetyPassRate: 1,
  meanQuality: 0.9,
  caseCount: 3,
  gatePassed: true,
  gitSha: 'abc1234',
  judgeModel: 'gpt-4.1-mini',
  judgeRubricVersion: 'gold-judge-v1',
  runMode: 'live',
  createdAt: '2026-08-09T00:00:00.000Z',
  ...overrides,
});

describe('goldEvalRuns checklist (SEC-205)', () => {
  it('marks correctness, safety, and trend pass when agentic meets gates', () => {
    const checklist = buildCutoverChecklist([
      baseRun({
        id: 'a1',
        engine: 'agentic',
        meanCorrectness: 0.9,
        safetyPassRate: 1,
        createdAt: '2026-08-09T03:00:00.000Z',
      }),
      baseRun({
        id: 'b1',
        engine: 'baseline',
        meanCorrectness: 0.85,
        createdAt: '2026-08-09T03:00:00.000Z',
      }),
      baseRun({
        id: 'a0',
        engine: 'agentic',
        meanCorrectness: 0.88,
        createdAt: '2026-08-09T02:00:00.000Z',
      }),
      baseRun({
        id: 'a-1',
        engine: 'agentic',
        meanCorrectness: 0.87,
        createdAt: '2026-08-09T01:00:00.000Z',
      }),
    ]);

    expect(checklist.items.find((i) => i.id === 'gold_correctness')?.status).toBe('pass');
    expect(checklist.items.find((i) => i.id === 'gold_safety')?.status).toBe('pass');
    expect(checklist.items.find((i) => i.id === 'gold_trend')?.status).toBe('pass');
    // Shadow parity / cost-latency items were retired after the cutover to agentic.
    expect(checklist.items.find((i) => i.id === 'shadow_parity')).toBeUndefined();
    expect(checklist.items.find((i) => i.id === 'cost_latency')).toBeUndefined();
    // All remaining gates are green.
    expect(checklist.allGreen).toBe(true);
  });

  it('fails safety when agentic safetyPassRate < 1', () => {
    const checklist = buildCutoverChecklist([
      baseRun({ engine: 'agentic', safetyPassRate: 0.66, meanCorrectness: 0.9 }),
      baseRun({ engine: 'baseline', meanCorrectness: 0.8 }),
    ]);
    expect(checklist.items.find((i) => i.id === 'gold_safety')?.status).toBe('fail');
  });
});

describe('goldEvalRuns operational links', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('builds GitHub, Railway, Phoenix, and backend links from env', () => {
    process.env.GOLD_EVAL_GITHUB_REPO = 'acme/backend';
    process.env.RAILWAY_PROJECT_ID = 'proj-1';
    process.env.RAILWAY_SERVICE_ID = 'svc-1';
    process.env.RAILWAY_ENVIRONMENT_ID = 'env-1';
    process.env.PHOENIX_PUBLIC_URL = 'https://phoenix.example.com/';
    process.env.API_PUBLIC_URL = 'https://api.example.com';

    const byId = Object.fromEntries(buildOperationalLinks().map((link) => [link.id, link]));

    expect(byId.github_nightly.url).toBe(
      'https://github.com/acme/backend/actions/workflows/gold-evals.yml'
    );
    expect(byId.railway_service.url).toBe(
      'https://railway.com/project/proj-1/service/svc-1?environmentId=env-1'
    );
    expect(byId.railway_metrics.url).toContain('/metrics?environmentId=env-1');
    expect(byId.phoenix_traces.url).toBe('https://phoenix.example.com');
    expect(byId.backend_version.url).toBe('https://api.example.com/version');
  });

  it('omits Railway/Phoenix links when their env is absent', () => {
    delete process.env.RAILWAY_PROJECT_ID;
    delete process.env.RAILWAY_SERVICE_ID;
    delete process.env.PHOENIX_PUBLIC_URL;
    delete process.env.PHOENIX_DASHBOARD_URL;

    const ids = buildOperationalLinks().map((link) => link.id);
    expect(ids).toContain('github_nightly');
    expect(ids).not.toContain('railway_service');
    expect(ids).not.toContain('phoenix_traces');
  });
});
