ALTER TABLE medical_file_extractions
    ADD COLUMN IF NOT EXISTS extraction_quality VARCHAR(16),
    ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC(5, 4);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'medical_file_extractions_method_check'
    ) THEN
        ALTER TABLE medical_file_extractions
            DROP CONSTRAINT medical_file_extractions_method_check;
    END IF;
END $$;

ALTER TABLE medical_file_extractions
    ADD CONSTRAINT medical_file_extractions_method_check
    CHECK (
        extraction_method IN (
            'pdf-parse',
            'raw-fallback',
            'cache',
            'textract',
            'vision-llm'
        )
    );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'medical_file_extractions_quality_check'
    ) THEN
        ALTER TABLE medical_file_extractions
            ADD CONSTRAINT medical_file_extractions_quality_check
            CHECK (
                extraction_quality IS NULL
                OR extraction_quality IN ('high', 'medium', 'low')
            );
    END IF;
END $$;
