-- SEC-208: durable structured symptom intake per case (versionable; independent of legacy case_intake text).
CREATE TABLE IF NOT EXISTS case_symptom_intake (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    payload JSONB NOT NULL,
    triage_level VARCHAR(40),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (case_id, version)
);

CREATE INDEX IF NOT EXISTS idx_case_symptom_intake_case_id ON case_symptom_intake(case_id);

COMMENT ON TABLE case_symptom_intake IS 'Structured clinical symptom intake for second-opinion cases (SEC-208).';
COMMENT ON COLUMN case_symptom_intake.payload IS 'CaseSymptomIntake JSON: chiefConcern, symptoms[], redFlags, triageLevel, acknowledgedEmergencyWarning';
