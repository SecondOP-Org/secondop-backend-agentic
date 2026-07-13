-- Durable sealed token→value vault for Presidio de-identification (production-grade reverse map).
-- Stores ONLY AES-GCM ciphertext. Never store plaintext PHI mappings.
-- Cleared after successful clinician re-identify + persist to minimize retention.

CREATE TABLE IF NOT EXISTS case_analysis_deid_vault (
  run_id UUID PRIMARY KEY REFERENCES case_analysis_runs(id) ON DELETE CASCADE,
  sealed_mapping TEXT,
  algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  entity_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cleared_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_case_analysis_deid_vault_uncleared
  ON case_analysis_deid_vault(updated_at DESC)
  WHERE sealed_mapping IS NOT NULL AND cleared_at IS NULL;

COMMENT ON TABLE case_analysis_deid_vault IS
  'Server-only sealed de-identification token maps. Never expose via API or observability payloads.';
