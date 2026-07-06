CREATE TABLE IF NOT EXISTS case_analysis_artifacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES case_analysis_runs(id) ON DELETE CASCADE,
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    file_id UUID REFERENCES medical_files(id) ON DELETE SET NULL,
    artifact_type VARCHAR(20) NOT NULL,
    stage_name VARCHAR(64) NOT NULL,
    engine VARCHAR(20) NOT NULL DEFAULT 'baseline',
    artifact_version VARCHAR(32) NOT NULL DEFAULT '1',
    json_payload JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT case_analysis_artifacts_type_check
        CHECK (artifact_type IN ('validation', 'extraction', 'synthesis', 'guard', 'final')),
    CONSTRAINT case_analysis_artifacts_engine_check
        CHECK (engine IN ('baseline', 'agentic'))
);

CREATE INDEX IF NOT EXISTS idx_case_analysis_artifacts_run_type
    ON case_analysis_artifacts(run_id, artifact_type, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_case_analysis_artifacts_case_created
    ON case_analysis_artifacts(case_id, created_at DESC);
