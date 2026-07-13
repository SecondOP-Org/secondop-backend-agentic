import {
  CaseAnalysisArtifact,
  formatStructuredSummary,
} from './analysisArtifact.service';
import {
  DeidentificationAudit,
  DeidentificationMapping,
  deidentifyText,
  mergeMappings,
  reidentifyText,
} from './deidentification.service';

const INTAKE_NARRATIVE_FIELDS = [
  'symptoms',
  'symptomDuration',
  'medicalHistory',
  'currentMedications',
  'allergies',
] as const;

export type IntakeNarratives = {
  symptoms: string;
  symptomDuration: string;
  medicalHistory: string;
  currentMedications: string;
  allergies: string;
};

export interface DeidentifiedIntakeResult<T extends IntakeNarratives> {
  intake: T;
  mapping: DeidentificationMapping;
  audits: DeidentificationAudit[];
}

export const deidentifyIntakeNarratives = async <T extends IntakeNarratives>(
  intake: T
): Promise<DeidentifiedIntakeResult<T>> => {
  const next: T = { ...intake };
  let mapping: DeidentificationMapping = {};
  const audits: DeidentificationAudit[] = [];

  for (const field of INTAKE_NARRATIVE_FIELDS) {
    const value = intake[field];
    if (typeof value !== 'string' || !value.trim()) {
      continue;
    }

    const result = await deidentifyText(value);
    next[field] = result.deidentifiedText as T[typeof field];
    mapping = mergeMappings(mapping, result.mapping);
    audits.push(result.audit);
  }

  return { intake: next, mapping, audits };
};

export const collectReportMappings = (
  reports: Array<{ mapping?: DeidentificationMapping }>
): DeidentificationMapping => {
  return mergeMappings(...reports.map((report) => report.mapping));
};

export const reidentifyArtifact = (
  artifact: CaseAnalysisArtifact,
  mapping: DeidentificationMapping
): { artifact: CaseAnalysisArtifact; summary: string; topQuestions: string[] } => {
  if (Object.keys(mapping).length === 0) {
    return {
      artifact,
      summary: formatStructuredSummary(artifact.structured_summary),
      topQuestions: artifact.questionnaire.specialist_questions.map((item) => item.question),
    };
  }

  const structuredSummary = {
    chief_concern: reidentifyText(artifact.structured_summary.chief_concern, mapping),
    key_report_findings: reidentifyText(artifact.structured_summary.key_report_findings, mapping),
    red_flags_to_discuss: reidentifyText(artifact.structured_summary.red_flags_to_discuss, mapping),
    follow_up_discussion_points: reidentifyText(
      artifact.structured_summary.follow_up_discussion_points,
      mapping
    ),
    limitations_caveats: reidentifyText(artifact.structured_summary.limitations_caveats, mapping),
  };

  const specialistQuestions = artifact.questionnaire.specialist_questions.map((item) => ({
    ...item,
    question: reidentifyText(item.question, mapping),
  }));

  const nextArtifact: CaseAnalysisArtifact = {
    ...artifact,
    structured_summary: structuredSummary,
    questionnaire: {
      specialist_questions: specialistQuestions,
    },
    uncertainty_flags: artifact.uncertainty_flags.map((flag) => reidentifyText(flag, mapping)),
    evidence_refs: artifact.evidence_refs.map((ref) => ({
      ...ref,
      snippet: reidentifyText(ref.snippet, mapping),
    })),
  };

  return {
    artifact: nextArtifact,
    summary: formatStructuredSummary(structuredSummary),
    topQuestions: specialistQuestions.map((item) => item.question),
  };
};

export { INTAKE_NARRATIVE_FIELDS };
