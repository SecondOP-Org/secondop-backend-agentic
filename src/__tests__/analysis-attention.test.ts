import {
  computeAttentionReason,
  emitPerCaseLatencyWarnIfNeeded,
  PER_CASE_LATENCY_WARN_MS,
} from '../services/analysisAttention.service';
import { LOW_CONFIDENCE_THRESHOLD } from '../evals/contractChecks';
import { query } from '../database/connection';
import logger from '../utils/logger';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedWarn = logger.warn as jest.MockedFunction<typeof logger.warn>;

describe('computeAttentionReason (SEC-122)', () => {
  it('marks failed runs as failed_terminal', () => {
    expect(
      computeAttentionReason({
        outcome: 'failed',
        confidenceScore: 0.2,
        latencyMs: PER_CASE_LATENCY_WARN_MS + 1,
        attemptCount: 3,
      })
    ).toBe('failed_terminal');
  });

  it('prefers low_confidence over slow and retried', () => {
    expect(
      computeAttentionReason({
        outcome: 'succeeded',
        confidenceScore: LOW_CONFIDENCE_THRESHOLD - 0.01,
        latencyMs: PER_CASE_LATENCY_WARN_MS + 1,
        attemptCount: 2,
      })
    ).toBe('low_confidence');
  });

  it('marks slow when latency exceeds warn threshold', () => {
    expect(
      computeAttentionReason({
        outcome: 'succeeded',
        confidenceScore: 0.95,
        latencyMs: PER_CASE_LATENCY_WARN_MS + 1,
        attemptCount: 1,
      })
    ).toBe('slow');
  });

  it('marks retried when attempt_count >= 2', () => {
    expect(
      computeAttentionReason({
        outcome: 'succeeded',
        confidenceScore: 0.95,
        latencyMs: 1000,
        attemptCount: 2,
      })
    ).toBe('retried');
  });

  it('returns null for a clean first-attempt success', () => {
    expect(
      computeAttentionReason({
        outcome: 'succeeded',
        confidenceScore: 0.95,
        latencyMs: 1000,
        attemptCount: 1,
      })
    ).toBeNull();
  });
});

describe('emitPerCaseLatencyWarnIfNeeded (SEC-123)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no-ops when latency is under threshold', async () => {
    await emitPerCaseLatencyWarnIfNeeded({
      runId: 'run-1',
      caseId: 'case-1',
      latencyMs: PER_CASE_LATENCY_WARN_MS - 1,
    });
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedWarn).not.toHaveBeenCalled();
  });

  it('logs step breakdown and sets span attrs when slow', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { step_name: 'synthesize', duration_ms: 90000 },
        { step_name: 'extract', duration_ms: 12000 },
      ],
    } as never);

    const addAttributes = jest.fn();
    await emitPerCaseLatencyWarnIfNeeded({
      runId: 'run-1',
      caseId: 'case-1',
      latencyMs: PER_CASE_LATENCY_WARN_MS + 5000,
      attentionReason: 'slow',
      runSpan: { addAttributes, end: jest.fn(), run: async (fn) => fn() },
    });

    expect(mockedWarn).toHaveBeenCalledWith(
      'Per-case analysis latency warning',
      expect.objectContaining({
        runId: 'run-1',
        slowestStep: 'synthesize',
        stepBreakdown: expect.any(Array),
      })
    );
    expect(addAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'per_case.latency_warn': true,
        'per_case.slowest_step': 'synthesize',
      })
    );
  });
});
