import { query } from '../database/connection';
import { GoldEngineScorecard, GoldEvalReport } from '../evals/goldEvalHarness';

export type GoldEvalRunRow = {
  id: string;
  goldSetVersion: string;
  engine: 'baseline' | 'agentic';
  meanCorrectness: number | null;
  safetyPassRate: number;
  meanQuality: number | null;
  caseCount: number;
  gatePassed: boolean;
  gitSha: string | null;
  judgeModel: string | null;
  judgeRubricVersion: string | null;
  runMode: 'live' | 'score-only';
  createdAt: string;
};

export type GoldEvalTrendPoint = {
  createdAt: string;
  goldSetVersion: string;
  gitSha: string | null;
  baseline: {
    meanCorrectness: number | null;
    safetyPassRate: number | null;
    meanQuality: number | null;
    gatePassed: boolean | null;
  };
  agentic: {
    meanCorrectness: number | null;
    safetyPassRate: number | null;
    meanQuality: number | null;
    gatePassed: boolean | null;
  };
};

export type GoldEvalCutoverChecklist = {
  generatedAt: string;
  items: Array<{
    id: string;
    label: string;
    status: 'pass' | 'fail' | 'unknown';
    detail: string;
  }>;
  allGreen: boolean;
};

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const mapRow = (row: Record<string, unknown>): GoldEvalRunRow => ({
  id: String(row.id),
  goldSetVersion: String(row.gold_set_version),
  engine: row.engine === 'agentic' ? 'agentic' : 'baseline',
  meanCorrectness: toNumber(row.mean_correctness),
  safetyPassRate: toNumber(row.safety_pass_rate) ?? 0,
  meanQuality: toNumber(row.mean_quality),
  caseCount: Number(row.case_count) || 0,
  gatePassed: Boolean(row.gate_passed),
  gitSha: row.git_sha == null ? null : String(row.git_sha),
  judgeModel: row.judge_model == null ? null : String(row.judge_model),
  judgeRubricVersion: row.judge_rubric_version == null ? null : String(row.judge_rubric_version),
  runMode: row.run_mode === 'score-only' ? 'score-only' : 'live',
  createdAt: new Date(String(row.created_at)).toISOString(),
});

const insertScorecard = async (
  report: GoldEvalReport,
  card: GoldEngineScorecard,
  gitSha: string | null
): Promise<string> => {
  const result = await query(
    `INSERT INTO gold_eval_runs (
       gold_set_version, engine, mean_correctness, safety_pass_rate, mean_quality,
       case_count, gate_passed, git_sha, judge_model, judge_rubric_version, run_mode, report_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     RETURNING id`,
    [
      card.goldSetVersion || report.goldSetVersion,
      card.engine,
      card.meanCorrectness,
      card.safetyPassRate,
      card.meanQuality,
      card.caseCount,
      report.gatePassed && card.safetyPassRate >= 1,
      gitSha,
      report.judgeModel,
      report.judgeRubricVersion,
      report.mode,
      JSON.stringify(report),
    ]
  );
  return String(result.rows[0].id);
};

export const persistGoldEvalReport = async (
  report: GoldEvalReport,
  options: { gitSha?: string | null } = {}
): Promise<{ ids: string[] }> => {
  const gitSha = options.gitSha ?? process.env.BACKEND_GIT_SHA ?? process.env.GIT_SHA ?? null;
  const ids: string[] = [];
  if (report.baseline) {
    ids.push(await insertScorecard(report, report.baseline, gitSha));
  }
  if (report.agentic) {
    ids.push(await insertScorecard(report, report.agentic, gitSha));
  }
  return { ids };
};

export const listGoldEvalRuns = async (limit = 50): Promise<GoldEvalRunRow[]> => {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const result = await query(
    `SELECT id, gold_set_version, engine, mean_correctness, safety_pass_rate, mean_quality,
            case_count, gate_passed, git_sha, judge_model, judge_rubric_version, run_mode, created_at
     FROM gold_eval_runs
     ORDER BY created_at DESC
     LIMIT $1`,
    [safeLimit]
  );
  return (result.rows as Array<Record<string, unknown>>).map((row) => mapRow(row));
};

export const getGoldEvalTrendReport = async (limit = 30): Promise<{
  generatedAt: string;
  runs: GoldEvalRunRow[];
  points: GoldEvalTrendPoint[];
  checklist: GoldEvalCutoverChecklist;
}> => {
  const runs = await listGoldEvalRuns(limit * 2);
  const byCreated = new Map<string, GoldEvalTrendPoint>();

  for (const run of runs) {
    const key = `${run.createdAt}|${run.gitSha || ''}|${run.goldSetVersion}`;
    const existing = byCreated.get(key) || {
      createdAt: run.createdAt,
      goldSetVersion: run.goldSetVersion,
      gitSha: run.gitSha,
      baseline: {
        meanCorrectness: null,
        safetyPassRate: null,
        meanQuality: null,
        gatePassed: null,
      },
      agentic: {
        meanCorrectness: null,
        safetyPassRate: null,
        meanQuality: null,
        gatePassed: null,
      },
    };
    existing[run.engine] = {
      meanCorrectness: run.meanCorrectness,
      safetyPassRate: run.safetyPassRate,
      meanQuality: run.meanQuality,
      gatePassed: run.gatePassed,
    };
    byCreated.set(key, existing);
  }

  const points = [...byCreated.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limit);

  return {
    generatedAt: new Date().toISOString(),
    runs,
    points,
    checklist: buildCutoverChecklist(runs),
  };
};

export const buildCutoverChecklist = (runs: GoldEvalRunRow[]): GoldEvalCutoverChecklist => {
  const latestBaseline = runs.find((run) => run.engine === 'baseline' && run.runMode === 'live')
    || runs.find((run) => run.engine === 'baseline');
  const latestAgentic = runs.find((run) => run.engine === 'agentic' && run.runMode === 'live')
    || runs.find((run) => run.engine === 'agentic');

  const agenticSeries = runs
    .filter((run) => run.engine === 'agentic' && run.meanCorrectness != null)
    .slice(0, 5)
    .map((run) => run.meanCorrectness as number)
    .reverse();

  let trendStatus: 'pass' | 'fail' | 'unknown' = 'unknown';
  let trendDetail = 'Need at least 3 agentic runs to assess trend.';
  if (agenticSeries.length >= 3) {
    const nonDecreasing = agenticSeries.every((value, index) =>
      index === 0 ? true : value + 0.01 >= agenticSeries[index - 1]
    );
    trendStatus = nonDecreasing ? 'pass' : 'fail';
    trendDetail = nonDecreasing
      ? `Last ${agenticSeries.length} agentic correctness values are stable/improving.`
      : `Recent agentic correctness declined across last ${agenticSeries.length} runs.`;
  }

  const correctnessStatus: 'pass' | 'fail' | 'unknown' =
    latestBaseline?.meanCorrectness == null || latestAgentic?.meanCorrectness == null
      ? 'unknown'
      : latestAgentic.meanCorrectness >= latestBaseline.meanCorrectness
        ? 'pass'
        : 'fail';

  const safetyStatus: 'pass' | 'fail' | 'unknown' =
    latestAgentic == null
      ? 'unknown'
      : latestAgentic.safetyPassRate >= 1
        ? 'pass'
        : 'fail';

  const items: GoldEvalCutoverChecklist['items'] = [
    {
      id: 'gold_correctness',
      label: 'Gold-set correctness: agentic ≥ baseline',
      status: correctnessStatus,
      detail:
        correctnessStatus === 'unknown'
          ? 'No paired baseline/agentic scorecards yet.'
          : `agentic=${latestAgentic?.meanCorrectness?.toFixed(3)} baseline=${latestBaseline?.meanCorrectness?.toFixed(3)}`,
    },
    {
      id: 'gold_safety',
      label: 'Safety pass-rate: agentic = 100%',
      status: safetyStatus,
      detail:
        safetyStatus === 'unknown'
          ? 'No agentic gold scorecard yet.'
          : `agentic safetyPassRate=${latestAgentic?.safetyPassRate.toFixed(3)}`,
    },
    {
      id: 'gold_trend',
      label: 'Nightly trend: stable/improving over recent runs',
      status: trendStatus,
      detail: trendDetail,
    },
    {
      id: 'shadow_parity',
      label: 'Production shadow parity: favor_agentic or parity',
      status: 'unknown',
      detail: 'Check /admin/shadow-parity (separate signal).',
    },
    {
      id: 'cost_latency',
      label: 'Cost/latency within budget',
      status: 'unknown',
      detail: 'Confirm via shadow parity + Railway metrics.',
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    items,
    allGreen: items.every((item) => item.status === 'pass'),
  };
};
