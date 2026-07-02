import {
  CaseAnalysisArtifact,
  StructuredSummary,
  defaultMedicalDisclaimer,
} from '../services/analysisArtifact.service';
import { ExtractedReport } from '../services/reportExtraction.service';

export const AI_CONTRACT_DISCLAIMER =
  'AI-generated support content; licensed clinician review required.';

export const LOW_CONFIDENCE_THRESHOLD = 0.7;

const sectionOrder: Array<keyof StructuredSummary> = [
  'chief_concern',
  'key_report_findings',
  'red_flags_to_discuss',
  'follow_up_discussion_points',
  'limitations_caveats',
];

const forbiddenClaimPatterns: Array<{ id: string; pattern: RegExp }> = [
  { id: 'diagnosis_directive', pattern: /\b(you are diagnosed with|confirmed diagnosis|diagnosis is)\b/i },
  { id: 'treatment_order', pattern: /\b(prescribe|start taking|take this medication|begin treatment with)\b/i },
  { id: 'emergency_directive', pattern: /\b(call 911|go to the emergency room immediately|seek emergency care now)\b/i },
];

export interface ContractCheckMetrics {
  schemaValid: boolean;
  disclaimerPresent: boolean;
  questionCountExact: boolean;
  forbiddenClaimDetected: boolean;
  lowConfidenceHasUncertaintyFlags: boolean;
}

export interface ContractCheckResult {
  passed: boolean;
  violations: string[];
  metrics: ContractCheckMetrics;
}

const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();

const isStructuredSummary = (value: unknown): value is StructuredSummary => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return sectionOrder.every((sectionKey) => typeof (value as Record<string, unknown>)[sectionKey] === 'string');
};

export const isValidCaseAnalysisArtifactShape = (value: unknown): value is CaseAnalysisArtifact => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const specialistQuestions =
    candidate.questionnaire &&
    typeof candidate.questionnaire === 'object' &&
    Array.isArray((candidate.questionnaire as { specialist_questions?: unknown }).specialist_questions)
      ? (candidate.questionnaire as { specialist_questions: unknown[] }).specialist_questions
      : null;

  return (
    isStructuredSummary(candidate.structured_summary) &&
    specialistQuestions !== null &&
    typeof candidate.confidence_score === 'number' &&
    Number.isFinite(candidate.confidence_score) &&
    candidate.confidence_score >= 0 &&
    candidate.confidence_score <= 1 &&
    typeof candidate.disclaimer === 'string' &&
    typeof candidate.model === 'string'
  );
};

export const hasRequiredDisclaimer = (disclaimer: string): boolean => {
  const normalized = normalize(disclaimer);
  if (!normalized) {
    return false;
  }

  if (normalized.includes(normalize(AI_CONTRACT_DISCLAIMER))) {
    return true;
  }

  if (normalized.includes(normalize(defaultMedicalDisclaimer))) {
    return true;
  }

  return /licensed clinician.*review required|clinician must review/.test(normalized);
};

export const detectForbiddenClaims = (text: string): string[] => {
  const violations: string[] = [];

  for (const rule of forbiddenClaimPatterns) {
    if (rule.pattern.test(text)) {
      violations.push(`Forbidden claim detected: ${rule.id}.`);
    }
  }

  return violations;
};

export const validateQuestionContract = (questions: string[]): string[] => {
  const violations: string[] = [];
  const normalizedQuestions = questions.map((question) => question.trim()).filter(Boolean);

  if (normalizedQuestions.length !== 3) {
    violations.push('Expected exactly 3 specialist-facing questions.');
  }

  const uniqueQuestions = new Set(normalizedQuestions.map((question) => question.toLowerCase()));
  if (uniqueQuestions.size !== normalizedQuestions.length) {
    violations.push('Specialist questions must be unique.');
  }

  const tooShort = normalizedQuestions.find((question) => question.length < 12);
  if (tooShort) {
    violations.push('Specialist questions must be meaningful prompts.');
  }

  return violations;
};

export const collectUncertaintySignals = (artifact: CaseAnalysisArtifact): string[] => {
  return [
    artifact.structured_summary.limitations_caveats,
    artifact.structured_summary.red_flags_to_discuss,
  ].filter((value) => value.trim().length > 0);
};

export const validateLowConfidenceUncertainty = (confidenceScore: number, uncertaintySignals: string[]): boolean => {
  if (confidenceScore >= LOW_CONFIDENCE_THRESHOLD) {
    return true;
  }

  return uncertaintySignals.some((signal) => signal.trim().length > 0);
};

export const validateEvidenceGrounding = (
  artifact: CaseAnalysisArtifact,
  reports: ExtractedReport[]
): string[] => {
  const violations: string[] = [];
  const evidenceRefs = artifact.evidence_refs || [];
  const populatedSections = Object.entries(artifact.structured_summary)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([section]) => section as keyof StructuredSummary);
  const coveredSections = new Set(evidenceRefs.map((ref) => ref.section));
  const reportNameSet = new Set(reports.map((report) => report.fileName));
  const reportTextByName = new Map(reports.map((report) => [report.fileName, normalize(report.text)]));

  if (evidenceRefs.length === 0) {
    violations.push('Evidence references are missing.');
  }

  if (populatedSections.length > 0 && !populatedSections.every((section) => coveredSections.has(section))) {
    violations.push('Evidence references do not cover all populated summary sections.');
  }

  if (evidenceRefs.length > 0 && !evidenceRefs.every((ref) => reportNameSet.has(ref.file_name))) {
    violations.push('Evidence references do not map to extracted reports.');
  }

  const ungroundedSnippet = evidenceRefs.find((ref) => {
    const reportText = reportTextByName.get(ref.file_name);
    if (!reportText) {
      return true;
    }

    const snippet = normalize(ref.snippet);
    return !snippet || !reportText.includes(snippet);
  });

  if (ungroundedSnippet) {
    violations.push('Evidence snippets are not grounded in extracted report text.');
  }

  return violations;
};

export const collectContractText = (artifact: CaseAnalysisArtifact): string => {
  const summaryText = sectionOrder.map((section) => artifact.structured_summary[section]).join('\n');
  const questionText = artifact.questionnaire.specialist_questions.map((item) => item.question).join('\n');
  const uncertaintyText = collectUncertaintySignals(artifact).join('\n');

  return [summaryText, questionText, uncertaintyText, artifact.disclaimer].join('\n');
};

export const validateCaseAnalysisContract = (
  artifact: CaseAnalysisArtifact,
  options: { reports?: ExtractedReport[] } = {}
): ContractCheckResult => {
  const violations: string[] = [];
  const schemaValid = isValidCaseAnalysisArtifactShape(artifact);

  if (!schemaValid) {
    violations.push('Artifact does not match required case analysis contract shape.');
  }

  const disclaimerPresent = hasRequiredDisclaimer(artifact.disclaimer);
  if (!disclaimerPresent) {
    violations.push('Required clinician-review disclaimer is missing.');
  }

  const questionViolations = validateQuestionContract(
    artifact.questionnaire.specialist_questions.map((item) => item.question)
  );
  violations.push(...questionViolations);

  const questionCountExact = !questionViolations.some((violation) =>
    violation.includes('exactly 3 specialist-facing questions')
  );

  const forbiddenClaims = detectForbiddenClaims(collectContractText(artifact));
  violations.push(...forbiddenClaims);

  const lowConfidenceHasUncertaintyFlags = validateLowConfidenceUncertainty(
    artifact.confidence_score,
    collectUncertaintySignals(artifact)
  );
  if (!lowConfidenceHasUncertaintyFlags) {
    violations.push('Low-confidence outputs must include explicit uncertainty flags.');
  }

  if (options.reports && options.reports.length > 0) {
    violations.push(...validateEvidenceGrounding(artifact, options.reports));
  }

  return {
    passed: violations.length === 0,
    violations,
    metrics: {
      schemaValid,
      disclaimerPresent,
      questionCountExact: questionCountExact && questionViolations.length === 0,
      forbiddenClaimDetected: forbiddenClaims.length > 0,
      lowConfidenceHasUncertaintyFlags,
    },
  };
};
