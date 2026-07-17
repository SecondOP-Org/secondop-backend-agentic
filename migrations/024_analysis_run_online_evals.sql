ALTER TABLE case_analysis_runs
  ADD COLUMN IF NOT EXISTS critic_score NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS contract_pass BOOLEAN;

COMMENT ON COLUMN case_analysis_runs.critic_score IS 'Agentic critic heuristic score 0-100 when available (SEC-108)';
COMMENT ON COLUMN case_analysis_runs.contract_pass IS 'Whether contract validation passed at run completion (SEC-108)';
