-- Patient controls whether AI analysis output is visible to assigned specialists.
ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS share_ai_analysis_with_specialists BOOLEAN NOT NULL DEFAULT TRUE;
