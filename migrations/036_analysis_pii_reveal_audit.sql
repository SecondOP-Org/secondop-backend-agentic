-- Owner-only analysis PII reveal audit (Change 5a). Metadata only — never store re-identified text.

CREATE TABLE IF NOT EXISTS analysis_pii_reveal_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  run_id UUID REFERENCES case_analysis_runs(id) ON DELETE SET NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  revealed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analysis_pii_reveal_events_case_created
  ON analysis_pii_reveal_events(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_pii_reveal_events_actor_created
  ON analysis_pii_reveal_events(actor_user_id, created_at DESC);
