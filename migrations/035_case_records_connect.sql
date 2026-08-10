-- SEC-216: patient records-connect connection state (FE contract §5).
-- Provider-agnostic: Synthea mock now; Metriport (or others) swap behind the same table/API.

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS records_status VARCHAR(20) NOT NULL DEFAULT 'none';

COMMENT ON COLUMN cases.records_status IS
  'Denormalized records-connect badge: none|pending|partial|complete|failed';

CREATE TABLE IF NOT EXISTS case_records_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL UNIQUE,
    provider VARCHAR(40) NOT NULL DEFAULT 'synthea_mock',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    document_count INTEGER NOT NULL DEFAULT 0,
    medications_count INTEGER NOT NULL DEFAULT 0,
    conditions_count INTEGER NOT NULL DEFAULT 0,
    labs_count INTEGER NOT NULL DEFAULT 0,
    identity_verified_at TIMESTAMP NULL,
    fetch_started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    error_code VARCHAR(80) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (case_id)
);

CREATE INDEX IF NOT EXISTS idx_case_records_connections_case_id
  ON case_records_connections(case_id);
CREATE INDEX IF NOT EXISTS idx_case_records_connections_connection_id
  ON case_records_connections(connection_id);

COMMENT ON TABLE case_records_connections IS
  'Patient-mediated records connect session per case (SEC-216). No PHI payloads stored here.';
COMMENT ON COLUMN case_records_connections.status IS
  'none|pending|partial|complete|failed — matches FE RecordsSummary.status';
COMMENT ON COLUMN case_records_connections.provider IS
  'Adapter key (synthea_mock, metriport, …) — swap without changing API contract';
