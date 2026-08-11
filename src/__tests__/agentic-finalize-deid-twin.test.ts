import { FinalizerAgent } from '../agentic/finalizer/finalizer.agent';
import { AgenticError, AgenticLoopState } from '../agentic/core/types';
import { CaseAnalysisContractError, enforceCaseAnalysisContract } from '../evals/contractChecks';
import { CaseAnalysisArtifact } from '../services/analysisArtifact.service';
import { reidentifyArtifact } from '../services/analysisDeidentification.service';
import { ExtractedReport } from '../services/reportExtraction.service';
import { AI_CONTRACT_DISCLAIMER } from '../evals/contractChecks';

const DISCLAIMER = AI_CONTRACT_DISCLAIMER;

const buildDeidentifiedArtifact = (): CaseAnalysisArtifact => ({
  structured_summary: {
    chief_concern: 'Follow-up for <PERSON_1> with possible ischemia',
    key_report_findings: 'DOB <DATE_TIME_1> noted; ECG limited',
    red_flags_to_discuss: 'Persistent chest pain may need urgent review',
    follow_up_discussion_points: 'Confirm history with <PERSON_1>',
    limitations_caveats: 'OCR limited; requires clinician review',
  },
  patient_summary: {
    overview: 'Your records mention follow-up for <PERSON_1> with possible heart-related findings.',
        what_your_results_show: 'Your results include the key findings from your records.',
    what_to_discuss: 'Please discuss ongoing chest pain and next steps for <PERSON_1> with your specialist.',
        next_steps: 'Ask about timing and what happens next.',
        what_we_couldnt_tell: 'Some details could not be determined from the records.',
    not_a_diagnosis: 'This is not a diagnosis. Your specialist reviews the full records and decides next steps.',
  },
  questionnaire: {
    specialist_questions: [
      { id: 'q1', question: 'Any prior imaging for <PERSON_1> that clarifies ischemia?' , source: 'ai' },
      { id: 'q2', question: 'Clarify timeline around <DATE_TIME_1> for symptom onset?' , source: 'ai' },
      { id: 'q3', question: 'Which follow-up interval is most appropriate given uncertainty?' , source: 'ai' },
    ],
  },
  confidence_score: 0.7,
  uncertainty_flags: ['Name referenced as <PERSON_1>'],
  disclaimer: DISCLAIMER,
  evidence_refs: [
    {
      file_name: 'report.pdf',
      section: 'chief_concern',
      snippet: 'Patient <PERSON_1> DOB <DATE_TIME_1>',
    },
    {
      file_name: 'report.pdf',
      section: 'key_report_findings',
      snippet: 'Patient <PERSON_1> DOB <DATE_TIME_1>',
    },
    {
      file_name: 'report.pdf',
      section: 'red_flags_to_discuss',
      snippet: 'Persistent chest pain may need urgent review',
    },
    {
      file_name: 'report.pdf',
      section: 'follow_up_discussion_points',
      snippet: 'Patient <PERSON_1> DOB <DATE_TIME_1>',
    },
    {
      file_name: 'report.pdf',
      section: 'limitations_caveats',
      snippet: 'Requires clinician review',
    },
  ],
  model: 'test-model',
  token_usage: null,
});

const buildDeidentifiedReports = (): ExtractedReport[] => [
  {
    fileId: 'f1',
    fileName: 'report.pdf',
    text: [
      'Patient <PERSON_1> DOB <DATE_TIME_1> with stable chest pain.',
      'Persistent chest pain may need urgent review.',
      'Requires clinician review.',
    ].join(' '),
    charCount: 120,
    extractionMethod: 'pdf-parse',
    extractionQuality: 'high',
    ocrConfidence: null,
    reused: false,
    mapping: {
      '<PERSON_1>': 'Jane Doe',
      '<DATE_TIME_1>': '01/02/1980',
    },
  },
];

const mapping = {
  '<PERSON_1>': 'Jane Doe',
  '<DATE_TIME_1>': '01/02/1980',
};

describe('agentic finalize de-id twin (SEC-106)', () => {
  const finalizer = new FinalizerAgent();

  it('regression: re-identified artifact fails grounding against de-identified reports', () => {
    const deidentified = buildDeidentifiedArtifact();
    const clinician = reidentifyArtifact(deidentified, mapping);
    const reports = buildDeidentifiedReports();

    expect(clinician.artifact.evidence_refs[0].snippet).toContain('Jane Doe');
    expect(() => enforceCaseAnalysisContract(clinician.artifact, { reports })).toThrow(
      CaseAnalysisContractError
    );
    expect(() => enforceCaseAnalysisContract(clinician.artifact, { reports })).toThrow(
      /not grounded in extracted report text/
    );
  });

  it('passes finalize with active de-id mapping and persists de-identified twin for case storage', () => {
    const deidentified = buildDeidentifiedArtifact();
    const clinician = reidentifyArtifact(deidentified, mapping);
    const reports = buildDeidentifiedReports();

    const state: AgenticLoopState = {
      caseId: 'case-deid',
      runId: 'run-deid',
      mode: 'agentic',
      stepCount: 4,
      refinementCount: 0,
      criticFeedback: null,
      intake: null,
      reports,
      analysis: {
        summary: clinician.summary,
        topQuestions: clinician.topQuestions,
        artifact: clinician.artifact,
        artifactDeidentified: deidentified,
        model: 'test-model',
      },
      observations: ['Follow-up for Jane Doe with possible ischemia'],
      finalArtifact: null,
      criticScore: null,
    };

    const finalized = finalizer.finalize(state);

    // Change 5a: durable case analysis stores the de-id twin; vault enables owner reveal.
    expect(finalized.artifact.structured_summary.chief_concern).toContain('<PERSON_1>');
    expect(finalized.artifact.evidence_refs[0].snippet).toContain('<PERSON_1>');
    expect(finalized.questions[0]).toContain('<PERSON_1>');
    expect(state.analysis?.artifact.evidence_refs[0].snippet).toContain('Jane Doe');
    expect(state.analysis?.artifactDeidentified.evidence_refs[0].snippet).toContain('<PERSON_1>');
  });

  it('still fails finalize when only the re-identified twin is available for contract checks', () => {
    const deidentified = buildDeidentifiedArtifact();
    const clinician = reidentifyArtifact(deidentified, mapping);
    const reports = buildDeidentifiedReports();

    const state: AgenticLoopState = {
      caseId: 'case-deid',
      runId: 'run-deid',
      mode: 'agentic',
      stepCount: 4,
      refinementCount: 0,
      criticFeedback: null,
      intake: null,
      reports,
      analysis: {
        summary: clinician.summary,
        topQuestions: clinician.topQuestions,
        artifact: clinician.artifact,
        // Simulate pre-fix path: de-id twin missing / identical to clinician
        artifactDeidentified: clinician.artifact,
        model: 'test-model',
      },
      observations: ['obs'],
      finalArtifact: null,
      criticScore: null,
    };

    expect(() => finalizer.finalize(state)).toThrow(AgenticError);
    expect(() => finalizer.finalize(state)).toThrow(/not grounded in extracted report text/);
  });
});
