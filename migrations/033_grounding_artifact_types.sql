-- SEC-206: allow normalized_entities + grounding stage artifact types
ALTER TABLE case_analysis_artifacts
  DROP CONSTRAINT IF EXISTS case_analysis_artifacts_type_check;

ALTER TABLE case_analysis_artifacts
  ADD CONSTRAINT case_analysis_artifacts_type_check
  CHECK (artifact_type IN (
    'validation',
    'extraction',
    'normalized_entities',
    'grounding',
    'synthesis',
    'guard',
    'final'
  ));
