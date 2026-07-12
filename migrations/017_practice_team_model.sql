CREATE TABLE practices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE practice_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('coordinator', 'clinician', 'attending')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (practice_id, doctor_id)
);

CREATE INDEX idx_practice_members_doctor_id ON practice_members(doctor_id);
CREATE INDEX idx_practice_members_practice_id ON practice_members(practice_id);

ALTER TABLE case_assignments
    ADD COLUMN IF NOT EXISTS practice_role VARCHAR(50) CHECK (practice_role IN ('attending', 'drafter', 'coordinator')),
    ADD COLUMN IF NOT EXISTS assigned_by_doctor_id UUID REFERENCES doctors(id),
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'draft'
        CHECK (review_status IN ('draft', 'pending_attending', 'approved'));

CREATE TABLE case_internal_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    author_doctor_id UUID NOT NULL REFERENCES doctors(id),
    note TEXT NOT NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'coordinator_only')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_case_internal_notes_case_id ON case_internal_notes(case_id);
