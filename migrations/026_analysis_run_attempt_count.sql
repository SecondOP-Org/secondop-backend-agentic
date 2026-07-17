ALTER TABLE case_analysis_runs
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN case_analysis_runs.attempt_count IS
  '1-based attempt counter for bounded transient retries (SEC-121)';
