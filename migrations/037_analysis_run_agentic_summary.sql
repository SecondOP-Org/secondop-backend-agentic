-- Agentic per-run summary for budgets + Analysis Observability
ALTER TABLE case_analysis_runs
  ADD COLUMN IF NOT EXISTS step_count INTEGER,
  ADD COLUMN IF NOT EXISTS refinement_count INTEGER,
  ADD COLUMN IF NOT EXISTS action_sequence JSONB,
  ADD COLUMN IF NOT EXISTS agents_invoked JSONB,
  ADD COLUMN IF NOT EXISTS planner_prompt_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS planner_completion_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS model_prompt_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS model_completion_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS budget_stop_reason TEXT;

ALTER TABLE case_analysis_runs
  DROP CONSTRAINT IF EXISTS case_analysis_runs_budget_stop_reason_check;

ALTER TABLE case_analysis_runs
  ADD CONSTRAINT case_analysis_runs_budget_stop_reason_check
  CHECK (
    budget_stop_reason IS NULL
    OR budget_stop_reason IN ('step', 'refinement', 'wall_clock', 'tokens', 'cost')
  );

COMMENT ON COLUMN case_analysis_runs.step_count IS 'Agentic planner loop step count at completion/failure';
COMMENT ON COLUMN case_analysis_runs.refinement_count IS 'Critic-driven refinement cycles used';
COMMENT ON COLUMN case_analysis_runs.action_sequence IS 'Ordered planner actions for the run';
COMMENT ON COLUMN case_analysis_runs.agents_invoked IS 'Control agents invoked (planner/critic/finalizer)';
COMMENT ON COLUMN case_analysis_runs.budget_stop_reason IS 'Which run budget halted the loop, if any';
