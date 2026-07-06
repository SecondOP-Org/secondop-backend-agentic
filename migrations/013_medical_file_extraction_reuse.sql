ALTER TABLE medical_files
    ADD COLUMN IF NOT EXISTS file_sha256 VARCHAR(64),
    ADD COLUMN IF NOT EXISTS pdf_validation_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS pdf_validation_error TEXT,
    ADD COLUMN IF NOT EXISTS pdf_extraction_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS pdf_extraction_error TEXT,
    ADD COLUMN IF NOT EXISTS pdf_extracted_at TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'medical_files_pdf_validation_status_check'
    ) THEN
        ALTER TABLE medical_files
            ADD CONSTRAINT medical_files_pdf_validation_status_check
            CHECK (pdf_validation_status IS NULL OR pdf_validation_status IN ('pending', 'succeeded', 'failed'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'medical_files_pdf_extraction_status_check'
    ) THEN
        ALTER TABLE medical_files
            ADD CONSTRAINT medical_files_pdf_extraction_status_check
            CHECK (
                pdf_extraction_status IS NULL
                OR pdf_extraction_status IN ('pending', 'succeeded', 'failed', 'reused')
            );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS medical_file_extractions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID NOT NULL REFERENCES medical_files(id) ON DELETE CASCADE,
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    file_sha256 VARCHAR(64) NOT NULL,
    extraction_method VARCHAR(32) NOT NULL,
    extracted_text TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT medical_file_extractions_unique_file_hash UNIQUE (file_id, file_sha256),
    CONSTRAINT medical_file_extractions_method_check
        CHECK (extraction_method IN ('pdf-parse', 'raw-fallback', 'cache'))
);

CREATE INDEX IF NOT EXISTS idx_medical_file_extractions_case_id
    ON medical_file_extractions(case_id);

CREATE INDEX IF NOT EXISTS idx_medical_file_extractions_file_id
    ON medical_file_extractions(file_id);
