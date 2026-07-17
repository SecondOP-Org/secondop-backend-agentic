-- SEC-122: per-case human-attention signal (independent of fleet SLO rates)
ALTER TABLE case_analysis_runs
  ADD COLUMN IF NOT EXISTS attention_reason TEXT NULL;

ALTER TABLE case_analysis_runs
  DROP CONSTRAINT IF EXISTS case_analysis_runs_attention_reason_check;

ALTER TABLE case_analysis_runs
  ADD CONSTRAINT case_analysis_runs_attention_reason_check
  CHECK (
    attention_reason IS NULL
    OR attention_reason IN ('low_confidence', 'slow', 'failed_terminal', 'retried')
  );

CREATE INDEX IF NOT EXISTS idx_case_analysis_runs_attention_reason
  ON case_analysis_runs (attention_reason)
  WHERE attention_reason IS NOT NULL;

COMMENT ON COLUMN case_analysis_runs.attention_reason IS
  'SEC-122: nullable per-run attention flag — low_confidence | slow | failed_terminal | retried';
