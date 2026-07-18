-- SEC-126: Append-only audit trail for imaging study ZIP downloads (egress).

CREATE TABLE IF NOT EXISTS imaging_study_download_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  study_uid TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  instance_count INTEGER NOT NULL DEFAULT 0,
  bytes_streamed BIGINT NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_imaging_study_download_events_case_created
  ON imaging_study_download_events(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_imaging_study_download_events_actor_created
  ON imaging_study_download_events(actor_user_id, created_at DESC);
