import {
  classifyFailClosedError,
  computeP95LatencyMs,
  evaluateTrailingSloBreaches,
  notifyAnalysisRunTerminal,
  postAlertWebhook,
} from '../services/analysisAlerting.service';
import { query } from '../database/connection';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('analysisAlerting.service (SEC-112)', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ALERT_WEBHOOK_URL;
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('classifies fail-closed de-id / PHI guard errors', () => {
    expect(
      classifyFailClosedError(
        'De-identification unavailable; analysis halted to avoid sending raw PHI to the model. timeout'
      )
    ).toBe('deid_halt');
    expect(classifyFailClosedError('Presidio analyzer unreachable')).toBe('presidio_unavailable');
    expect(
      classifyFailClosedError('DEID_ENABLED=true requires DEID_REVERSIBLE_KEY so token maps can be sealed')
    ).toBe('missing_reversible_key');
    expect(classifyFailClosedError('PHI guard rejected prompt')).toBe('phi_guard');
    expect(classifyFailClosedError('Evidence snippets are not grounded')).toBeNull();
  });

  it('computes p95 from sorted latencies', () => {
    const values = Array.from({ length: 20 }, (_, index) => (index + 1) * 1000);
    expect(computeP95LatencyMs(values)).toBe(19000);
  });

  it('flags success-rate and p95 SLO breaches', () => {
    const runs = [
      ...Array.from({ length: 18 }, (_, index) => ({
        id: `ok-${index}`,
        case_id: 'c',
        status: 'succeeded',
        latency_ms: 10_000,
      })),
      { id: 'f1', case_id: 'c', status: 'failed', latency_ms: 200_000 },
      { id: 'f2', case_id: 'c', status: 'failed', latency_ms: 200_000 },
    ];

    const breaches = evaluateTrailingSloBreaches(runs);
    expect(breaches.map((item) => item.kind).sort()).toEqual(['p95_latency', 'success_rate']);
  });

  it('does not post when ALERT_WEBHOOK_URL is unset', async () => {
    await expect(postAlertWebhook('hello')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts Slack-compatible JSON to ALERT_WEBHOOK_URL', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.slack.test/services/T/B/X';

    await expect(postAlertWebhook('hello')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('https://hooks.slack.test/services/T/B/X', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
  });

  it('alerts immediately on fail-closed and evaluates trailing SLOs', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.slack.test/services/T/B/X';
    mockedQuery.mockResolvedValueOnce({
      rows: [
        ...Array.from({ length: 19 }, (_, index) => ({
          id: `ok-${index}`,
          case_id: 'case-a',
          status: 'succeeded',
          latency_ms: 5_000,
        })),
        {
          id: 'run-fail',
          case_id: 'case-b',
          status: 'failed',
          latency_ms: 8_000,
        },
      ],
    } as any);

    await notifyAnalysisRunTerminal({
      runId: 'run-fail',
      caseId: 'case-b',
      errorMessage:
        'De-identification unavailable; analysis halted to avoid sending raw PHI to the model. down',
    });

    expect(global.fetch).toHaveBeenCalled();
    const bodies = (global.fetch as jest.Mock).mock.calls.map(
      (call) => JSON.parse(call[1].body as string).text as string
    );
    expect(bodies.some((text) => text.includes('FAIL-CLOSED') && text.includes('deid_halt'))).toBe(
      true
    );
    expect(bodies.some((text) => text.includes('caseId=case-b') && text.includes('runId=run-fail'))).toBe(
      true
    );
  });
});
