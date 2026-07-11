-- Allow 0–3 patient-supplied specialist questions (AI optional path).
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_specialist_questions_check;

ALTER TABLE cases
    ADD CONSTRAINT cases_specialist_questions_check
    CHECK (
        specialist_questions IS NULL
        OR (
            jsonb_typeof(specialist_questions) = 'array'
            AND jsonb_array_length(specialist_questions) <= 3
        )
    );
