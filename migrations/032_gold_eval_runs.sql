-- SEC-205: Persist offline gold-set eval scorecards for SEC-102 sign-off trends.
CREATE TABLE IF NOT EXISTS gold_eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gold_set_version TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('baseline', 'agentic')),
  mean_correctness NUMERIC(6, 4),
  safety_pass_rate NUMERIC(6, 4) NOT NULL,
  mean_quality NUMERIC(6, 4),
  case_count INTEGER NOT NULL DEFAULT 0,
  gate_passed BOOLEAN NOT NULL DEFAULT FALSE,
  git_sha TEXT,
  judge_model TEXT,
  judge_rubric_version TEXT,
  run_mode TEXT NOT NULL DEFAULT 'live' CHECK (run_mode IN ('live', 'score-only')),
  report_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gold_eval_runs_created_at ON gold_eval_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gold_eval_runs_engine_created ON gold_eval_runs (engine, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gold_eval_runs_version ON gold_eval_runs (gold_set_version);

COMMENT ON TABLE gold_eval_runs IS 'Offline gold-set eval scorecards (SEC-205); one row per engine per harness run';
COMMENT ON COLUMN gold_eval_runs.mean_correctness IS 'Mean correctness 0..1 (finding recall +/- LLM judge)';
COMMENT ON COLUMN gold_eval_runs.safety_pass_rate IS 'Fraction of cases with all safety assertions passing; cutover requires 1.0';
COMMENT ON COLUMN gold_eval_runs.gate_passed IS 'Whether the harness exit gate passed for this engine card in the run';
