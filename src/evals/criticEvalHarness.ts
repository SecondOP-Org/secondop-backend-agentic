import { CriticAgent } from '../agentic/critic/critic.agent';
import { AgenticFinalArtifact, AgenticLoopState } from '../agentic/core/types';
import { AI_CONTRACT_DISCLAIMER } from './contractChecks';
import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';
import { ExtractedReport } from '../services/reportExtraction.service';

export interface CriticEvalFixture {
  name: string;
  artifact: AgenticFinalArtifact;
  state: AgenticLoopState;
  expectedPass: boolean;
}

export interface CriticEvalResult {
  name: string;
  expectedPass: boolean;
  actualPass: boolean;
  score: number;
  reasons: string[];
}

const buildReports = (): ExtractedReport[] => [
  {
    fileId: 'report-1',
    fileName: 'report-a.pdf',
    text: [
      'Possible ischemic chest pain with uncertain etiology',
      'ECG remains normal and serial biomarkers are recommended',
      'Persistent chest pain cannot exclude ischemia',
      'Close clinician review and serial biomarkers',
      'Findings remain limited and require clinician review',
      'Patient reports intermittent chest pain. ECG remains normal. Serial biomarkers and close clinician review are recommended. Persistent chest pain cannot exclude ischemia.',
    ].join('. '),
    charCount: 380,
  },
];

const buildBaseState = (artifact: AgenticFinalArtifact, reports: ExtractedReport[]): AgenticLoopState => ({
  caseId: 'eval-case',
  runId: 'eval-run',
  mode: 'shadow',
  stepCount: 0,
  refinementCount: 0,
  criticFeedback: null,
  intake: {
    age: 52,
    sex: 'male',
    specialtyContext: 'cardiology',
    symptoms: 'chest pain',
    symptomDuration: '1 week',
    medicalHistory: 'hypertension',
    currentMedications: 'lisinopril',
    allergies: 'none',
  },
  reports,
  analysis: null,
  observations: artifact.observations,
  finalArtifact: null,
  criticScore: null,
});

export const buildCriticEvalFixtures = (): CriticEvalFixture[] => {
  const reports = buildReports();

  const groundedArtifactData = buildCaseAnalysisArtifact({
    structuredSummary: {
      chief_concern: 'Possible ischemic chest pain with uncertain etiology',
      key_report_findings: 'ECG remains normal and serial biomarkers are recommended',
      red_flags_to_discuss: 'Persistent chest pain cannot exclude ischemia',
      follow_up_discussion_points: 'Close clinician review and serial biomarkers',
      limitations_caveats: 'Findings remain limited and require clinician review',
    },
    specialistQuestions: [
      'What immediate diagnostics are recommended given persistent chest pain?',
      'Could ischemia still be present despite a normal ECG?',
      'What follow-up timeline is safest for clinician review?',
    ],
    confidenceScore: 0.61,
    disclaimer: AI_CONTRACT_DISCLAIMER,
    model: 'gpt-4.1-mini',
    reports,
  });

  const groundedArtifact: AgenticFinalArtifact = {
    summary:
      'Chief Concern\nPossible ischemic chest pain with uncertain etiology\n\nKey Report Findings\nECG remains normal and serial biomarkers are recommended\n\nRed Flags To Discuss\nPersistent chest pain cannot exclude ischemia\n\nFollow-up Discussion Points\nClose clinician review and serial biomarkers\n\nLimitations/Caveats\nFindings remain limited and require clinician review',
    questions: groundedArtifactData.questionnaire.specialist_questions.map((item) => item.question),
    observations: ['Chief Concern: Possible ischemic chest pain with uncertain etiology'],
    artifact: groundedArtifactData,
    model: 'gpt-4.1-mini',
  };

  const missingUncertaintyArtifact: AgenticFinalArtifact = {
    ...groundedArtifact,
    artifact: {
      ...groundedArtifact.artifact,
      confidence_score: 0.4,
      structured_summary: {
        ...groundedArtifact.artifact.structured_summary,
        limitations_caveats: '',
        red_flags_to_discuss: '',
      },
    },
  };

  const ungroundedEvidenceArtifact: AgenticFinalArtifact = {
    ...groundedArtifact,
    artifact: {
      ...groundedArtifact.artifact,
      evidence_refs: groundedArtifact.artifact.evidence_refs.map((ref) => ({
        ...ref,
        snippet: 'This fabricated snippet does not exist in the report text.',
      })),
    },
  };

  return [
    {
      name: 'grounded_artifact_passes',
      artifact: groundedArtifact,
      state: buildBaseState(groundedArtifact, reports),
      expectedPass: true,
    },
    {
      name: 'low_confidence_without_uncertainty_flags_fails',
      artifact: missingUncertaintyArtifact,
      state: buildBaseState(missingUncertaintyArtifact, reports),
      expectedPass: false,
    },
    {
      name: 'ungrounded_evidence_fails',
      artifact: ungroundedEvidenceArtifact,
      state: buildBaseState(ungroundedEvidenceArtifact, reports),
      expectedPass: false,
    },
  ];
};

export const runCriticEvalHarness = async (): Promise<CriticEvalResult[]> => {
  const critic = new CriticAgent();
  const fixtures = buildCriticEvalFixtures();

  return Promise.all(
    fixtures.map(async (fixture) => {
      const result = await critic.evaluate(fixture.artifact, fixture.state);

      return {
        name: fixture.name,
        expectedPass: fixture.expectedPass,
        actualPass: result.passed,
        score: result.score,
        reasons: result.reasons,
      };
    })
  );
};
