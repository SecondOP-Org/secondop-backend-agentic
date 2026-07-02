import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';
import { ExtractedReport } from '../services/reportExtraction.service';
import { AI_CONTRACT_DISCLAIMER, validateCaseAnalysisContract } from './contractChecks';

export interface ContractEvalFixture {
  name: string;
  artifact: ReturnType<typeof buildCaseAnalysisArtifact>;
  reports?: ExtractedReport[];
  expectedPass: boolean;
}

export interface ContractEvalResult {
  name: string;
  expectedPass: boolean;
  actualPass: boolean;
  violations: string[];
  metrics: ReturnType<typeof validateCaseAnalysisContract>['metrics'];
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
      'Patient reports intermittent chest pain. ECG remains normal. Serial biomarkers and close clinician review are recommended.',
    ].join('. '),
    charCount: 320,
  },
];

const buildValidArtifact = (reports: ExtractedReport[]) =>
  buildCaseAnalysisArtifact({
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
    reports,
    model: 'gpt-4.1-mini',
  });

export const buildContractEvalFixtures = (): ContractEvalFixture[] => {
  const reports = buildReports();
  const validArtifact = buildValidArtifact(reports);

  return [
    {
      name: 'valid_contract_passes',
      artifact: validArtifact,
      reports,
      expectedPass: true,
    },
    {
      name: 'missing_disclaimer_fails',
      artifact: {
        ...validArtifact,
        disclaimer: 'Summary only.',
      },
      expectedPass: false,
    },
    {
      name: 'forbidden_diagnosis_claim_fails',
      artifact: {
        ...validArtifact,
        structured_summary: {
          ...validArtifact.structured_summary,
          chief_concern: 'You are diagnosed with acute coronary syndrome.',
        },
      },
      expectedPass: false,
    },
    {
      name: 'low_confidence_without_flags_fails',
      artifact: {
        ...validArtifact,
        confidence_score: 0.4,
        structured_summary: {
          ...validArtifact.structured_summary,
          limitations_caveats: '',
          red_flags_to_discuss: '',
        },
      },
      expectedPass: false,
    },
    {
      name: 'ungrounded_evidence_fails',
      artifact: {
        ...validArtifact,
        evidence_refs: validArtifact.evidence_refs.map((ref) => ({
          ...ref,
          snippet: 'Fabricated snippet not present in source report.',
        })),
      },
      reports,
      expectedPass: false,
    },
  ];
};

export const runContractEvalHarness = (): ContractEvalResult[] => {
  return buildContractEvalFixtures().map((fixture) => {
    const result = validateCaseAnalysisContract(fixture.artifact, { reports: fixture.reports });

    return {
      name: fixture.name,
      expectedPass: fixture.expectedPass,
      actualPass: result.passed,
      violations: result.violations,
      metrics: result.metrics,
    };
  });
};
