import {
  aggregateShadowParityPairs,
  decideShadowParityVerdict,
  ShadowParityPair,
} from '../services/shadowParity.service';

const pair = (overrides: Partial<ShadowParityPair> = {}): ShadowParityPair => ({
  baselineSucceeded: true,
  agenticSucceeded: true,
  baselineLatencyMs: 10_000,
  agenticLatencyMs: 12_000,
  baselineTotalTokens: 1_000,
  agenticTotalTokens: 1_200,
  baselineCostUsd: 0.01,
  agenticCostUsd: 0.012,
  criticScore: 90,
  criticPassed: true,
  contractPassed: true,
  baselineSummaryLength: 400,
  agenticSummaryLength: 420,
  questionOverlapRatio: 0.66,
  baselineEvidenceCount: 3,
  agenticEvidenceCount: 4,
  ...overrides,
});

describe('shadowParity.service (SEC-109)', () => {
  it('aggregates baseline vs agentic metrics into table rows', () => {
    const report = aggregateShadowParityPairs([
      pair(),
      pair({
        agenticSucceeded: false,
        contractPassed: false,
        criticPassed: false,
        criticScore: 40,
        agenticLatencyMs: 200_000,
      }),
      ...Array.from({ length: 4 }, () => pair()),
    ]);

    expect(report.pairCount).toBe(6);
    expect(report.baseline.successRate).toBe(1);
    expect(report.agentic.successRate).toBeCloseTo(5 / 6, 5);
    expect(report.critic.passRate).toBeCloseTo(5 / 6, 5);
    expect(report.rows.some((row) => row.metric === 'Success rate')).toBe(true);
    expect(report.rows.some((row) => row.metric === 'Avg evidence count')).toBe(true);
    expect(report.verdict.code).toBeTruthy();
  });

  it('returns insufficient_data below five pairs', () => {
    const verdict = decideShadowParityVerdict({
      pairCount: 2,
      baseline: {
        sampleSize: 2,
        successRate: 1,
        p50LatencyMs: 10,
        p95LatencyMs: 20,
        avgTotalTokens: 100,
        avgEstimatedCostUsd: 0.01,
      },
      agentic: {
        sampleSize: 2,
        successRate: 1,
        p50LatencyMs: 12,
        p95LatencyMs: 22,
        avgTotalTokens: 120,
        avgEstimatedCostUsd: 0.012,
      },
      criticPassRate: 1,
    });

    expect(verdict.code).toBe('insufficient_data');
  });

  it('favors agentic when SLOs look healthy', () => {
    const verdict = decideShadowParityVerdict({
      pairCount: 10,
      baseline: {
        sampleSize: 10,
        successRate: 0.95,
        p50LatencyMs: 20_000,
        p95LatencyMs: 40_000,
        avgTotalTokens: 1000,
        avgEstimatedCostUsd: 0.02,
      },
      agentic: {
        sampleSize: 10,
        successRate: 0.94,
        p50LatencyMs: 22_000,
        p95LatencyMs: 45_000,
        avgTotalTokens: 1100,
        avgEstimatedCostUsd: 0.022,
      },
      criticPassRate: 0.9,
    });

    expect(verdict.code).toBe('favor_agentic');
  });
});
