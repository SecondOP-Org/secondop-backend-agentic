import {
  buildSafeProgressEvent,
  mapStepNameToProgressStage,
} from '../services/analysisProgress.service';

describe('analysis progress mapping', () => {
  it('maps baseline and agentic step names to safe public stages', () => {
    expect(mapStepNameToProgressStage('intake-validation')).toBe('validating_files');
    expect(mapStepNameToProgressStage('report-extraction')).toBe('extracting_reports');
    expect(mapStepNameToProgressStage('clinical-synthesis')).toBe('synthesizing_summary');
    expect(mapStepNameToProgressStage('question-guard')).toBe('guardrail_check');
    expect(mapStepNameToProgressStage('persist-results')).toBe('persisting_result');
    expect(mapStepNameToProgressStage('agentic:validate_intake')).toBe('validating_files');
    expect(mapStepNameToProgressStage('agentic:extract_reports')).toBe('extracting_reports');
    expect(mapStepNameToProgressStage('agentic:synthesize_summary')).toBe('synthesizing_summary');
    expect(mapStepNameToProgressStage('agentic:guard_questions')).toBe('guardrail_check');
    expect(mapStepNameToProgressStage('agentic:finalize')).toBe('persisting_result');
  });

  it('ignores unknown step names', () => {
    expect(mapStepNameToProgressStage('secret-prompt-step')).toBeNull();
    expect(mapStepNameToProgressStage('')).toBeNull();
  });

  it('builds payloads without clinical fields', () => {
    const event = buildSafeProgressEvent({
      event: 'extracting_reports',
      runId: 'run-1',
      caseId: 'case-1',
      at: '2026-07-14T12:00:00.000Z',
    });

    expect(event).toEqual({
      event: 'extracting_reports',
      runId: 'run-1',
      caseId: 'case-1',
      at: '2026-07-14T12:00:00.000Z',
    });
    expect(Object.keys(event).sort()).toEqual(['at', 'caseId', 'event', 'runId']);
  });
});
