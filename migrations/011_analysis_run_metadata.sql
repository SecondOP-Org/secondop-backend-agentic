-- SEC-49: normalize execution modes and enrich case_analysis_runs metadata

UPDATE case_analysis_runs
SET execution_mode = CASE execution_mode
  WHEN 'off' THEN 'baseline'
  WHEN 'direct' THEN 'agentic'
  ELSE execution_mode
END
WHERE execution_mode IN ('off', 'direct');

UPDATE case_analysis_shadow_results
SET mode = CASE mode
  WHEN 'off' THEN 'baseline'
  WHEN 'direct' THEN 'agentic'
  ELSE mode
END
WHERE mode IN ('off', 'direct');

ALTER TABLE case_analysis_runs
  ADD COLUMN IF NOT EXISTS pipeline_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS model_version VARCHAR(100),
  ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
  ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS total_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS error_message TEXT;

UPDATE case_analysis_runs
SET error_message = error
WHERE error_message IS NULL
  AND error IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'case_analysis_runs_execution_mode_check'
  ) THEN
    ALTER TABLE case_analysis_runs
      DROP CONSTRAINT case_analysis_runs_execution_mode_check;
  END IF;
END $$;

ALTER TABLE case_analysis_runs
  ADD CONSTRAINT case_analysis_runs_execution_mode_check
  CHECK (execution_mode IN ('baseline', 'shadow', 'agentic', 'off', 'direct'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'case_analysis_shadow_results_mode_check'
  ) THEN
    ALTER TABLE case_analysis_shadow_results
      DROP CONSTRAINT case_analysis_shadow_results_mode_check;
  END IF;
END $$;

ALTER TABLE case_analysis_shadow_results
  ADD CONSTRAINT case_analysis_shadow_results_mode_check
  CHECK (mode IN ('baseline', 'shadow', 'agentic', 'off', 'direct'));
