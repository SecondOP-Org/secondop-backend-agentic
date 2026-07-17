import { query } from '../database/connection';

const DEFAULT_SAMPLE_LIMIT = 200;

export type ShadowParityVerdict =
  | 'favor_agentic'
  | 'favor_baseline'
  | 'parity'
  | 'insufficient_data';

export type EngineParityMetrics = {
  sampleSize: number;
  successRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  avgTotalTokens: number | null;
  avgEstimatedCostUsd: number | null;
};

export type ShadowParityArtifactDiff = {
  avgBaselineSummaryLength: number | null;
  avgAgenticSummaryLength: number | null;
  avgQuestionOverlapRatio: number | null;
  avgBaselineEvidenceCount: number | null;
  avgAgenticEvidenceCount: number | null;
};

export type ShadowParityReport = {
  generatedAt: string;
  sampleLimit: number;
  pairCount: number;
  baseline: EngineParityMetrics;
  agentic: EngineParityMetrics;
  critic: {
    sampleSize: number;
    avgScore: number | null;
    passRate: number | null;
  };
  contract: {
    sampleSize: number;
    passRate: number | null;
  };
  artifactDiff: ShadowParityArtifactDiff;
  verdict: {
    code: ShadowParityVerdict;
    rationale: string;
  };
  rows: Array<{
    metric: string;
    baseline: string;
    agentic: string;
    note?: string;
  }>;
};

export type ShadowParityPair = {
  baselineSucceeded: boolean | null;
  agenticSucceeded: boolean;
  baselineLatencyMs: number | null;
  agenticLatencyMs: number | null;
  baselineTotalTokens: number | null;
  agenticTotalTokens: number | null;
  baselineCostUsd: number | null;
  agenticCostUsd: number | null;
  criticScore: number | null;
  criticPassed: boolean | null;
  contractPassed: boolean | null;
  baselineSummaryLength: number | null;
  agenticSummaryLength: number | null;
  questionOverlapRatio: number | null;
  baselineEvidenceCount: number | null;
  agenticEvidenceCount: number | null;
};

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const percentile = (values: number[], ratio: number): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index] ?? null;
};

const average = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const rate = (passed: number, total: number): number | null => {
  if (total === 0) {
    return null;
  }
  return passed / total;
};

const formatRate = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(1)}%`;

const formatMs = (value: number | null): string =>
  value === null ? '—' : `${Math.round(value)} ms`;

const formatNumber = (value: number | null, digits = 1): string =>
  value === null ? '—' : value.toFixed(digits);

const countEvidenceRefs = (artifact: unknown): number | null => {
  if (!artifact || typeof artifact !== 'object') {
    return null;
  }
  const refs = (artifact as { evidence_refs?: unknown }).evidence_refs;
  return Array.isArray(refs) ? refs.length : null;
};

const isContractFailureMessage = (error: string | null | undefined): boolean => {
  if (!error) {
    return false;
  }
  const normalized = error.toLowerCase();
  return (
    normalized.includes('validation_error') ||
    normalized.includes('contract') ||
    normalized.includes('not grounded') ||
    normalized.includes('evidence snippets')
  );
};

export const buildEngineMetrics = (
  pairs: ShadowParityPair[],
  side: 'baseline' | 'agentic'
): EngineParityMetrics => {
  const succeededFlags =
    side === 'baseline'
      ? pairs.map((pair) => pair.baselineSucceeded).filter((value): value is boolean => value !== null)
      : pairs.map((pair) => pair.agenticSucceeded);

  const latencies =
    side === 'baseline'
      ? pairs
          .map((pair) => pair.baselineLatencyMs)
          .filter((value): value is number => typeof value === 'number')
      : pairs
          .map((pair) => pair.agenticLatencyMs)
          .filter((value): value is number => typeof value === 'number');

  const tokens =
    side === 'baseline'
      ? pairs
          .map((pair) => pair.baselineTotalTokens)
          .filter((value): value is number => typeof value === 'number')
      : pairs
          .map((pair) => pair.agenticTotalTokens)
          .filter((value): value is number => typeof value === 'number');

  const costs =
    side === 'baseline'
      ? pairs
          .map((pair) => pair.baselineCostUsd)
          .filter((value): value is number => typeof value === 'number')
      : pairs
          .map((pair) => pair.agenticCostUsd)
          .filter((value): value is number => typeof value === 'number');

  return {
    sampleSize: succeededFlags.length,
    successRate: rate(succeededFlags.filter(Boolean).length, succeededFlags.length),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    avgTotalTokens: average(tokens),
    avgEstimatedCostUsd: average(costs),
  };
};

export const decideShadowParityVerdict = (input: {
  pairCount: number;
  baseline: EngineParityMetrics;
  agentic: EngineParityMetrics;
  criticPassRate: number | null;
}): { code: ShadowParityVerdict; rationale: string } => {
  if (input.pairCount < 5) {
    return {
      code: 'insufficient_data',
      rationale: `Need at least 5 shadow pairs for a promotion decision (have ${input.pairCount}).`,
    };
  }

  const baselineSuccess = input.baseline.successRate ?? 0;
  const agenticSuccess = input.agentic.successRate ?? 0;
  const criticPass = input.criticPassRate;
  const baselineP95 = input.baseline.p95LatencyMs;
  const agenticP95 = input.agentic.p95LatencyMs;

  const successDeltaPp = (agenticSuccess - baselineSuccess) * 100;
  const latencyOk =
    baselineP95 === null || agenticP95 === null || agenticP95 <= baselineP95 * 1.5 + 5_000;
  const criticOk = criticPass === null || criticPass >= 0.8;

  if (successDeltaPp >= -2 && criticOk && latencyOk && agenticSuccess >= 0.9) {
    return {
      code: 'favor_agentic',
      rationale:
        'Agentic success is within 2pp of baseline (or better), critic pass ≥ 80% when present, and p95 latency is not >1.5× baseline (+5s slack).',
    };
  }

  if (successDeltaPp <= -5 || (criticPass !== null && criticPass < 0.7) || !latencyOk) {
    return {
      code: 'favor_baseline',
      rationale:
        'Agentic trails baseline on success (≥5pp), critic pass < 70%, and/or p95 latency exceeds 1.5× baseline.',
    };
  }

  return {
    code: 'parity',
    rationale: 'Shadow metrics are close; keep collecting pairs before collapsing AI directories (SEC-102).',
  };
};

export const aggregateShadowParityPairs = (
  pairs: ShadowParityPair[],
  sampleLimit = DEFAULT_SAMPLE_LIMIT
): ShadowParityReport => {
  const baseline = buildEngineMetrics(pairs, 'baseline');
  const agentic = buildEngineMetrics(pairs, 'agentic');

  const criticScores = pairs
    .map((pair) => pair.criticScore)
    .filter((value): value is number => typeof value === 'number');
  const criticFlags = pairs
    .map((pair) => pair.criticPassed)
    .filter((value): value is boolean => value !== null);
  const contractFlags = pairs
    .map((pair) => pair.contractPassed)
    .filter((value): value is boolean => value !== null);

  const criticPassRate = rate(criticFlags.filter(Boolean).length, criticFlags.length);
  const contractPassRate = rate(contractFlags.filter(Boolean).length, contractFlags.length);

  const artifactDiff: ShadowParityArtifactDiff = {
    avgBaselineSummaryLength: average(
      pairs
        .map((pair) => pair.baselineSummaryLength)
        .filter((value): value is number => typeof value === 'number')
    ),
    avgAgenticSummaryLength: average(
      pairs
        .map((pair) => pair.agenticSummaryLength)
        .filter((value): value is number => typeof value === 'number')
    ),
    avgQuestionOverlapRatio: average(
      pairs
        .map((pair) => pair.questionOverlapRatio)
        .filter((value): value is number => typeof value === 'number')
    ),
    avgBaselineEvidenceCount: average(
      pairs
        .map((pair) => pair.baselineEvidenceCount)
        .filter((value): value is number => typeof value === 'number')
    ),
    avgAgenticEvidenceCount: average(
      pairs
        .map((pair) => pair.agenticEvidenceCount)
        .filter((value): value is number => typeof value === 'number')
    ),
  };

  const verdict = decideShadowParityVerdict({
    pairCount: pairs.length,
    baseline,
    agentic,
    criticPassRate,
  });

  return {
    generatedAt: new Date().toISOString(),
    sampleLimit,
    pairCount: pairs.length,
    baseline,
    agentic,
    critic: {
      sampleSize: criticFlags.length,
      avgScore: average(criticScores),
      passRate: criticPassRate,
    },
    contract: {
      sampleSize: contractFlags.length,
      passRate: contractPassRate,
    },
    artifactDiff,
    verdict,
    rows: [
      {
        metric: 'Success rate',
        baseline: formatRate(baseline.successRate),
        agentic: formatRate(agentic.successRate),
      },
      {
        metric: 'p50 latency',
        baseline: formatMs(baseline.p50LatencyMs),
        agentic: formatMs(agentic.p50LatencyMs),
      },
      {
        metric: 'p95 latency',
        baseline: formatMs(baseline.p95LatencyMs),
        agentic: formatMs(agentic.p95LatencyMs),
      },
      {
        metric: 'Avg tokens',
        baseline: formatNumber(baseline.avgTotalTokens, 0),
        agentic: formatNumber(agentic.avgTotalTokens, 0),
      },
      {
        metric: 'Avg cost (USD)',
        baseline: formatNumber(baseline.avgEstimatedCostUsd, 4),
        agentic: formatNumber(agentic.avgEstimatedCostUsd, 4),
      },
      {
        metric: 'Critic score (avg)',
        baseline: '—',
        agentic: formatNumber(average(criticScores), 1),
        note: `n=${criticScores.length}`,
      },
      {
        metric: 'Critic pass rate',
        baseline: '—',
        agentic: formatRate(criticPassRate),
        note: `n=${criticFlags.length}`,
      },
      {
        metric: 'Contract pass rate',
        baseline: '—',
        agentic: formatRate(contractPassRate),
        note: 'Succeeded without validation/grounding error',
      },
      {
        metric: 'Avg summary length',
        baseline: formatNumber(artifactDiff.avgBaselineSummaryLength, 0),
        agentic: formatNumber(artifactDiff.avgAgenticSummaryLength, 0),
      },
      {
        metric: 'Avg question overlap',
        baseline: '—',
        agentic: formatRate(artifactDiff.avgQuestionOverlapRatio),
        note: 'matching / max(baseline, agentic) question counts',
      },
      {
        metric: 'Avg evidence count',
        baseline: formatNumber(artifactDiff.avgBaselineEvidenceCount, 1),
        agentic: formatNumber(artifactDiff.avgAgenticEvidenceCount, 1),
      },
    ],
  };
};

const mapPairRow = (row: Record<string, unknown>): ShadowParityPair => {
  const comparison =
    row.comparison_payload && typeof row.comparison_payload === 'object'
      ? (row.comparison_payload as Record<string, unknown>)
      : null;

  const baselineQuestionCount = toNullableNumber(comparison?.baselineQuestionCount);
  const agenticQuestionCount = toNullableNumber(comparison?.agenticQuestionCount);
  const matchingQuestionCount = toNullableNumber(comparison?.matchingQuestionCount);

  let questionOverlapRatio: number | null = null;
  if (
    matchingQuestionCount !== null &&
    baselineQuestionCount !== null &&
    agenticQuestionCount !== null
  ) {
    const denom = Math.max(baselineQuestionCount, agenticQuestionCount, 1);
    questionOverlapRatio = matchingQuestionCount / denom;
  }

  const agenticSucceeded = String(row.agentic_final_status) === 'succeeded';
  const agenticError = typeof row.agentic_error === 'string' ? row.agentic_error : null;
  const critic =
    row.critic_score_json && typeof row.critic_score_json === 'object'
      ? (row.critic_score_json as { passed?: boolean; score?: number })
      : null;

  const baselineStatus = typeof row.baseline_status === 'string' ? row.baseline_status : null;

  let contractPassed: boolean | null = null;
  if (agenticSucceeded) {
    contractPassed = true;
  } else if (isContractFailureMessage(agenticError)) {
    contractPassed = false;
  }

  return {
    baselineSucceeded: baselineStatus === null ? null : baselineStatus === 'succeeded',
    agenticSucceeded,
    baselineLatencyMs: toNullableNumber(row.baseline_latency_ms),
    agenticLatencyMs: toNullableNumber(row.agentic_latency_ms),
    baselineTotalTokens: toNullableNumber(row.baseline_total_tokens),
    agenticTotalTokens: toNullableNumber(row.agentic_total_tokens),
    baselineCostUsd: toNullableNumber(row.baseline_estimated_cost_usd),
    agenticCostUsd: toNullableNumber(row.agentic_estimated_cost_usd),
    criticScore: toNullableNumber(critic?.score),
    criticPassed: typeof critic?.passed === 'boolean' ? critic.passed : null,
    contractPassed,
    baselineSummaryLength:
      toNullableNumber(comparison?.baselineSummaryLength) ??
      (typeof row.baseline_summary === 'string' ? row.baseline_summary.length : null),
    agenticSummaryLength:
      toNullableNumber(comparison?.agenticSummaryLength) ??
      (typeof row.agentic_summary === 'string' ? row.agentic_summary.length : null),
    questionOverlapRatio,
    baselineEvidenceCount: countEvidenceRefs(row.baseline_artifact_json),
    agenticEvidenceCount: countEvidenceRefs(row.agentic_artifact_json),
  };
};

export const getShadowParityReport = async (
  sampleLimit = DEFAULT_SAMPLE_LIMIT
): Promise<ShadowParityReport> => {
  const limit = Math.min(Math.max(sampleLimit, 1), 500);

  const result = await query(
    `SELECT
       s.final_status AS agentic_final_status,
       s.error AS agentic_error,
       s.summary AS agentic_summary,
       s.critic_score_json,
       s.artifact_json AS agentic_artifact_json,
       ar_agentic.latency_ms AS agentic_latency_ms,
       ar_agentic.total_tokens AS agentic_total_tokens,
       ar_agentic.estimated_cost_usd AS agentic_estimated_cost_usd,
       ar_baseline.status AS baseline_status,
       ar_baseline.latency_ms AS baseline_latency_ms,
       ar_baseline.total_tokens AS baseline_total_tokens,
       ar_baseline.estimated_cost_usd AS baseline_estimated_cost_usd,
       c.analysis_summary AS baseline_summary,
       c.analysis_artifact AS baseline_artifact_json,
       comparison.json_payload AS comparison_payload
     FROM case_analysis_shadow_results s
     JOIN case_analysis_runs ar_agentic ON ar_agentic.id = s.run_id
     LEFT JOIN LATERAL (
       SELECT status, latency_ms, total_tokens, estimated_cost_usd
       FROM case_analysis_runs b
       WHERE b.case_id = s.case_id
         AND b.engine = 'baseline'
       ORDER BY b.created_at DESC
       LIMIT 1
     ) ar_baseline ON TRUE
     LEFT JOIN cases c ON c.id = s.case_id
     LEFT JOIN LATERAL (
       SELECT json_payload
       FROM case_analysis_artifacts a
       WHERE a.case_id = s.case_id
         AND a.stage_name = 'shadow-comparison'
       ORDER BY a.created_at DESC
       LIMIT 1
     ) comparison ON TRUE
     WHERE s.mode = 'shadow'
     ORDER BY s.created_at DESC
     LIMIT $1`,
    [limit]
  );

  const pairs = (result.rows as Array<Record<string, unknown>>).map(mapPairRow);
  return aggregateShadowParityPairs(pairs, limit);
};
