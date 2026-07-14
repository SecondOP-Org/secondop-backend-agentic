-- Server-only sealed maps for DICOM header PHI de-identification on ingest.
-- Stores AES-GCM ciphertext of original tag/UID values. Never expose via API.

CREATE TABLE IF NOT EXISTS dicom_deid_vault (
  file_id UUID PRIMARY KEY REFERENCES medical_files(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  study_instance_uid TEXT,
  sealed_mapping TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  tag_count INTEGER NOT NULL DEFAULT 0,
  audit_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dicom_deid_vault_case
  ON dicom_deid_vault(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dicom_deid_vault_study
  ON dicom_deid_vault(study_instance_uid)
  WHERE study_instance_uid IS NOT NULL;

COMMENT ON TABLE dicom_deid_vault IS
  'Server-only sealed DICOM tag/UID maps after ingest de-identification. Never expose via API.';
