import {
  ANALYSIS_MAX_ATTEMPTS,
  canRetryAnalysisAttempt,
  classifyAnalysisFailure,
  getRetryBackoffSeconds,
} from '../services/analysisFailureClassifier.service';

describe('analysisFailureClassifier (SEC-121)', () => {
  it('classifies de-id fail-closed halt as RETRYABLE', () => {
    const result = classifyAnalysisFailure(
      new Error(
        'De-identification unavailable; analysis halted to avoid sending raw PHI to the model.'
      )
    );
    expect(result.classification).toBe('RETRYABLE');
  });

  it('classifies Presidio outages as RETRYABLE', () => {
    expect(classifyAnalysisFailure(new Error('Presidio HTTP 503')).classification).toBe(
      'RETRYABLE'
    );
  });

  it('classifies model timeout as RETRYABLE', () => {
    expect(
      classifyAnalysisFailure(new Error('Analysis timed out after 60000ms')).classification
    ).toBe('RETRYABLE');
  });

  it('classifies validation_error as TERMINAL', () => {
    expect(
      classifyAnalysisFailure({ code: 'validation_error', message: 'Bad intake' }).classification
    ).toBe('TERMINAL');
    expect(
      classifyAnalysisFailure(new Error('[validation_error] Bad intake')).classification
    ).toBe('TERMINAL');
  });

  it('classifies contract/grounding failures as TERMINAL', () => {
    expect(
      classifyAnalysisFailure(
        new Error('Analysis contract validation failed: evidence not grounded')
      ).classification
    ).toBe('TERMINAL');
  });

  it('classifies missing reports as TERMINAL', () => {
    expect(
      classifyAnalysisFailure(
        new Error('At least one medical report (PDF or image) is required for analysis.')
      ).classification
    ).toBe('TERMINAL');
  });

  it('classifies missing reversible key as TERMINAL', () => {
    expect(
      classifyAnalysisFailure(
        new Error('DEID_ENABLED=true requires DEID_REVERSIBLE_KEY to be set')
      ).classification
    ).toBe('TERMINAL');
  });

  it('limits attempts and maps backoff', () => {
    expect(ANALYSIS_MAX_ATTEMPTS).toBe(3);
    expect(canRetryAnalysisAttempt(1)).toBe(true);
    expect(canRetryAnalysisAttempt(2)).toBe(true);
    expect(canRetryAnalysisAttempt(3)).toBe(false);
    expect(getRetryBackoffSeconds(2)).toBe(5);
    expect(getRetryBackoffSeconds(3)).toBe(20);
  });
});
