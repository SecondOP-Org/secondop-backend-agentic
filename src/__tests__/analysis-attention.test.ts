import {
  computeAttentionReason,
  PER_CASE_LATENCY_WARN_MS,
} from '../services/analysisAttention.service';
import { LOW_CONFIDENCE_THRESHOLD } from '../evals/contractChecks';

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
