ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS ai_draft_edit_ratio NUMERIC(6, 4);

COMMENT ON COLUMN cases.ai_draft_edit_ratio IS
  'Mean normalized Levenshtein distance (0-1) between inserted AI drafts and final signed answers (SEC-111)';
