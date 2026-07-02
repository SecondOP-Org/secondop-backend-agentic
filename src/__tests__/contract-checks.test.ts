import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';
import {
  AI_CONTRACT_DISCLAIMER,
  detectForbiddenClaims,
  hasRequiredDisclaimer,
  isValidCaseAnalysisArtifactShape,
  validateCaseAnalysisContract,
  validateLowConfidenceUncertainty,
  validateQuestionContract,
} from '../evals/contractChecks';

describe('contractChecks', () => {
  const reports = [
    {
      fileId: 'report-1',
      fileName: 'report-a.pdf',
      text: [
        'Possible ischemic chest pain',
        'ECG remains normal',
        'Persistent chest pain cannot exclude ischemia',
        'Close clinician review',
        'Findings remain limited',
        'ECG remains normal. Serial biomarkers are recommended.',
      ].join('. '),
      charCount: 180,
    },
  ];

  const validArtifact = buildCaseAnalysisArtifact({
    structuredSummary: {
      chief_concern: 'Possible ischemic chest pain',
      key_report_findings: 'ECG remains normal',
      red_flags_to_discuss: 'Persistent chest pain cannot exclude ischemia',
      follow_up_discussion_points: 'Close clinician review',
      limitations_caveats: 'Findings remain limited',
    },
    specialistQuestions: [
      'What immediate diagnostics are recommended?',
      'Could ischemia still be present despite a normal ECG?',
      'What follow-up timeline is safest for clinician review?',
    ],
    confidenceScore: 0.61,
    disclaimer: AI_CONTRACT_DISCLAIMER,
    reports,
    model: 'gpt-4.1-mini',
  });

  it('accepts a valid artifact shape', () => {
    expect(isValidCaseAnalysisArtifactShape(validArtifact)).toBe(true);
  });

  it('requires clinician-review disclaimer language', () => {
    expect(hasRequiredDisclaimer(AI_CONTRACT_DISCLAIMER)).toBe(true);
    expect(hasRequiredDisclaimer('No disclaimer here.')).toBe(false);
  });

  it('detects forbidden diagnosis and treatment claims', () => {
    expect(detectForbiddenClaims('You are diagnosed with acute coronary syndrome.')).toContain(
      'Forbidden claim detected: diagnosis_directive.'
    );
    expect(detectForbiddenClaims('Start taking aspirin immediately.')).toContain(
      'Forbidden claim detected: treatment_order.'
    );
  });

  it('requires uncertainty signals for low-confidence outputs', () => {
    expect(validateLowConfidenceUncertainty(0.4, [])).toBe(false);
    expect(validateLowConfidenceUncertainty(0.4, ['Evidence is limited'])).toBe(true);
  });

  it('enforces exactly three specialist questions', () => {
    expect(validateQuestionContract(['one', 'two'])).toContain('Expected exactly 3 specialist-facing questions.');
  });

  it('passes a valid contract artifact', () => {
    const result = validateCaseAnalysisContract(validArtifact, { reports });
    expect(result.passed).toBe(true);
    expect(result.metrics.schemaValid).toBe(true);
    expect(result.metrics.forbiddenClaimDetected).toBe(false);
  });

  it('fails when disclaimer or grounding is missing', () => {
    const missingDisclaimer = validateCaseAnalysisContract({
      ...validArtifact,
      disclaimer: 'Summary only.',
    });
    expect(missingDisclaimer.passed).toBe(false);

    const ungrounded = validateCaseAnalysisContract(
      {
        ...validArtifact,
        evidence_refs: validArtifact.evidence_refs.map((ref) => ({
          ...ref,
          snippet: 'Not in source report.',
        })),
      },
      { reports }
    );
    expect(ungrounded.passed).toBe(false);
  });
});
