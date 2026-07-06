import { ExtractedReport } from './reportExtraction.service';

export interface TokenUsageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StructuredSummary {
  chief_concern: string;
  key_report_findings: string;
  red_flags_to_discuss: string;
  follow_up_discussion_points: string;
  limitations_caveats: string;
}

export interface QuestionnaireItem {
  id: string;
  question: string;
}

export interface EvidenceRef {
  file_id?: string;
  file_name: string;
  section: keyof StructuredSummary;
  snippet: string;
}

export interface CaseAnalysisArtifact {
  structured_summary: StructuredSummary;
  questionnaire: {
    specialist_questions: QuestionnaireItem[];
  };
  confidence_score: number;
  uncertainty_flags: string[];
  disclaimer: string;
  evidence_refs: EvidenceRef[];
  model: string;
  token_usage: TokenUsageMetrics | null;
}

const sectionOrder: Array<keyof StructuredSummary> = [
  'chief_concern',
  'key_report_findings',
  'red_flags_to_discuss',
  'follow_up_discussion_points',
  'limitations_caveats',
];

const sectionLabels: Record<keyof StructuredSummary, string> = {
  chief_concern: 'Chief Concern',
  key_report_findings: 'Key Report Findings',
  red_flags_to_discuss: 'Red Flags To Discuss',
  follow_up_discussion_points: 'Follow-up Discussion Points',
  limitations_caveats: 'Limitations/Caveats',
};

export const defaultMedicalDisclaimer =
  'This summary supports a second-opinion workflow and is not a diagnosis or treatment plan. A licensed clinician must review the source records and patient context before acting on it.';

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
};

const clampConfidenceScore = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, Number(numeric.toFixed(2))));
};

export const createEmptyStructuredSummary = (): StructuredSummary => ({
  chief_concern: '',
  key_report_findings: '',
  red_flags_to_discuss: '',
  follow_up_discussion_points: '',
  limitations_caveats: '',
});

export const formatStructuredSummary = (structuredSummary: StructuredSummary): string => {
  return sectionOrder
    .map((sectionKey) => `${sectionLabels[sectionKey]}\n${normalizeText(structuredSummary[sectionKey]) || 'Not available.'}`)
    .join('\n\n');
};

export const extractObservationsFromArtifact = (artifact: CaseAnalysisArtifact | null): string[] => {
  if (!artifact) {
    return [];
  }

  return sectionOrder
    .map((sectionKey) => {
      const value = normalizeText(artifact.structured_summary[sectionKey]);
      if (!value) {
        return null;
      }

      return `${sectionLabels[sectionKey]}: ${value}`;
    })
    .filter((value): value is string => Boolean(value));
};

const normalizeForMatch = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();

const tokenizeForOverlap = (value: string): string[] =>
  normalizeForMatch(value)
    .split(' ')
    .filter((word) => word.length > 3);

export const findGroundedEvidenceSnippet = (
  sectionText: string,
  reports: ExtractedReport[]
): { fileId: string; fileName: string; snippet: string } | null => {
  const normalizedSection = normalizeForMatch(sectionText);
  if (!normalizedSection || reports.length === 0) {
    return null;
  }

  const sectionWords = tokenizeForOverlap(sectionText);
  const minOverlap = Math.min(2, Math.max(1, sectionWords.length));
  let bestMatch: { fileId: string; fileName: string; snippet: string; score: number } | null = null;

  for (const report of reports) {
    const normalizedReport = normalizeForMatch(report.text);
    if (normalizedSection.length >= 12 && normalizedReport.includes(normalizedSection.slice(0, 120))) {
      const startIndex = normalizedReport.indexOf(normalizedSection.slice(0, 120));
      const rawSnippet = report.text.slice(startIndex, startIndex + 220).trim();
      return {
        fileId: report.fileId,
        fileName: report.fileName,
        snippet: rawSnippet || sectionText.slice(0, 220),
      };
    }

    const chunks = report.text
      .split(/[.!?\n]+/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length >= 12);

    for (const chunk of chunks) {
      const normalizedChunk = normalizeForMatch(chunk);
      const overlap = sectionWords.filter((word) => normalizedChunk.includes(word)).length;
      if (overlap < minOverlap) {
        continue;
      }

      if (!bestMatch || overlap > bestMatch.score) {
        bestMatch = {
          fileId: report.fileId,
          fileName: report.fileName,
          snippet: chunk.slice(0, 220),
          score: overlap,
        };
      }
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    fileId: bestMatch.fileId,
    fileName: bestMatch.fileName,
    snippet: bestMatch.snippet,
  };
};

const buildEvidenceRefs = (
  structuredSummary: StructuredSummary,
  reports: ExtractedReport[] | undefined
): EvidenceRef[] => {
  if (!reports || reports.length === 0) {
    return [];
  }

  return sectionOrder
    .map((sectionKey) => {
      const content = normalizeText(structuredSummary[sectionKey]);
      if (!content) {
        return null;
      }

      const grounded = findGroundedEvidenceSnippet(content, reports);
      if (!grounded) {
        return null;
      }

      return {
        file_id: grounded.fileId,
        file_name: grounded.fileName,
        section: sectionKey,
        snippet: grounded.snippet,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);
};

const normalizeUncertaintyFlags = (flags: string[] | undefined): string[] =>
  (flags || []).map((flag) => normalizeText(flag)).filter(Boolean);

export const buildCaseAnalysisArtifact = (input: {
  structuredSummary: StructuredSummary;
  specialistQuestions: string[];
  confidenceScore?: number;
  uncertaintyFlags?: string[];
  disclaimer?: string;
  reports?: ExtractedReport[];
  model: string;
  tokenUsage?: TokenUsageMetrics;
}): CaseAnalysisArtifact => {
  const structuredSummary = {
    chief_concern: normalizeText(input.structuredSummary.chief_concern),
    key_report_findings: normalizeText(input.structuredSummary.key_report_findings),
    red_flags_to_discuss: normalizeText(input.structuredSummary.red_flags_to_discuss),
    follow_up_discussion_points: normalizeText(input.structuredSummary.follow_up_discussion_points),
    limitations_caveats: normalizeText(input.structuredSummary.limitations_caveats),
  };

  const questions = input.specialistQuestions.map((question, index) => ({
    id: `q${index + 1}`,
    question: normalizeText(question),
  }));

  return {
    structured_summary: structuredSummary,
    questionnaire: {
      specialist_questions: questions,
    },
    confidence_score: clampConfidenceScore(input.confidenceScore),
    uncertainty_flags: normalizeUncertaintyFlags(input.uncertaintyFlags),
    disclaimer: normalizeText(input.disclaimer) || defaultMedicalDisclaimer,
    evidence_refs: buildEvidenceRefs(structuredSummary, input.reports),
    model: input.model,
    token_usage: input.tokenUsage || null,
  };
};

const parseStructuredSummaryFromLegacySummary = (summary: string): StructuredSummary => {
  if (!summary.trim()) {
    return createEmptyStructuredSummary();
  }

  const result = createEmptyStructuredSummary();
  const lines = summary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let currentSection: keyof StructuredSummary | null = null;
  const labelToSection = new Map<string, keyof StructuredSummary>(
    sectionOrder.map((sectionKey) => [sectionLabels[sectionKey].toLowerCase(), sectionKey])
  );

  for (const line of lines) {
    const normalized = line.replace(/:\s*$/, '').toLowerCase();
    const matchedSection = labelToSection.get(normalized);
    if (matchedSection) {
      currentSection = matchedSection;
      continue;
    }

    const inlineEntry = Array.from(labelToSection.entries()).find(([label]) => line.toLowerCase().startsWith(`${label}:`));
    if (inlineEntry) {
      currentSection = inlineEntry[1];
      const inlineValue = line.slice(inlineEntry[0].length + 1).trim();
      result[currentSection] = normalizeText(inlineValue);
      continue;
    }

    if (currentSection) {
      const prior = result[currentSection];
      result[currentSection] = normalizeText(`${prior} ${line}`);
    }
  }

  return result;
};

const isStructuredSummary = (value: unknown): value is StructuredSummary => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return sectionOrder.every((sectionKey) => typeof (value as Record<string, unknown>)[sectionKey] === 'string');
};

const isCaseAnalysisArtifact = (value: unknown): value is CaseAnalysisArtifact => {
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

  const uncertaintyFlags = Array.isArray(candidate.uncertainty_flags) ? candidate.uncertainty_flags : [];

  return (
    isStructuredSummary(candidate.structured_summary) &&
    specialistQuestions !== null &&
    typeof candidate.confidence_score === 'number' &&
    uncertaintyFlags.every((flag) => typeof flag === 'string') &&
    typeof candidate.disclaimer === 'string' &&
    typeof candidate.model === 'string'
  );
};

export const hydrateCaseAnalysisArtifact = (input: {
  artifact: unknown;
  summary: string | null;
  questions: string[] | null;
  model: string | null;
}): CaseAnalysisArtifact | null => {
  if (isCaseAnalysisArtifact(input.artifact)) {
    const artifact = input.artifact as CaseAnalysisArtifact;
    return {
      ...artifact,
      uncertainty_flags: Array.isArray(artifact.uncertainty_flags) ? artifact.uncertainty_flags : [],
      evidence_refs: Array.isArray(artifact.evidence_refs) ? artifact.evidence_refs : [],
    };
  }

  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  const questions = Array.isArray(input.questions)
    ? input.questions.filter((question): question is string => typeof question === 'string' && Boolean(question.trim()))
    : [];

  if (!summary && questions.length === 0) {
    return null;
  }

  return buildCaseAnalysisArtifact({
    structuredSummary: parseStructuredSummaryFromLegacySummary(summary),
    specialistQuestions: questions.slice(0, 3),
    model: input.model || 'unknown',
    confidenceScore: 0.5,
    uncertaintyFlags: [],
  });
};

export const artifactQuestionsToStrings = (artifact: CaseAnalysisArtifact | null): string[] => {
  if (!artifact) {
    return [];
  }

  return artifact.questionnaire.specialist_questions.map((item) => item.question);
};
