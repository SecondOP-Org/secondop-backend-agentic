-- SEC-81: Shared per-file DICOM annotations + append-only audit trail.
-- Replaces per-user unique (file_id, saved_by) with one live document per file.

-- Keep the newest row per file_id (personal blobs become a single team document).
DELETE FROM file_annotations a
WHERE a.ctid NOT IN (
  SELECT DISTINCT ON (file_id) ctid
  FROM file_annotations
  ORDER BY file_id, updated_at DESC NULLS LAST, created_at DESC, id DESC
);

DROP INDEX IF EXISTS idx_file_annotations_file_user_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_annotations_file_unique
  ON file_annotations(file_id);

CREATE TABLE IF NOT EXISTS file_annotation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES medical_files(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  annotation_id TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(20) NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_file_annotation_events_file_created
  ON file_annotation_events(file_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_annotation_events_case_created
  ON file_annotation_events(case_id, created_at DESC);
