import { ExtractedReport } from './reportExtraction.service';
import {
  isNavOrOcrJunkSnippet,
  isProseLikeEvidenceSnippet,
  sanitizeEvidenceSnippetForCitation,
} from './extractedReportSanitize.service';

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

/** Plain-language patient register (SEC-189). Restates clinical findings only. */
export interface PatientSummary {
  overview: string;
  what_to_discuss: string;
  not_a_diagnosis: string;
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

export interface ArtifactCitation {
  id: string;
  source: 'pubmed';
  pmid: string;
  title: string;
  journal: string;
  year: number;
  url: string;
  relevanceNote?: string;
}

export interface ArtifactTrialMatch {
  id: string;
  source: 'clinicaltrials';
  nctId: string;
  title: string;
  phase?: string;
  status: string;
  url: string;
  eligibilitySummary?: string;
}

export interface ArtifactCitationLink {
  section: string;
  citationIds: string[];
}

export interface CaseAnalysisArtifact {
  structured_summary: StructuredSummary;
  patient_summary: PatientSummary;
  questionnaire: {
    specialist_questions: QuestionnaireItem[];
  };
  confidence_score: number;
  uncertainty_flags: string[];
  disclaimer: string;
  evidence_refs: EvidenceRef[];
  /** External PubMed citations (API-sourced only). */
  citations?: ArtifactCitation[];
  /** ClinicalTrials.gov matches (API-sourced only). */
  trialMatches?: ArtifactTrialMatch[];
  /** Links from summary sections / claims to citation ids. */
  citation_links?: ArtifactCitationLink[];
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

export const createEmptyPatientSummary = (): PatientSummary => ({
  overview: '',
  what_to_discuss: '',
  not_a_diagnosis: '',
});

const patientSummaryKeys: Array<keyof PatientSummary> = ['overview', 'what_to_discuss', 'not_a_diagnosis'];

export const normalizePatientSummary = (value: unknown): PatientSummary => {
  if (!value || typeof value !== 'object') {
    return createEmptyPatientSummary();
  }

  const candidate = value as Record<string, unknown>;
  return {
    overview: normalizeText(candidate.overview),
    what_to_discuss: normalizeText(candidate.what_to_discuss),
    not_a_diagnosis: normalizeText(candidate.not_a_diagnosis),
  };
};

export const isPatientSummaryPopulated = (summary: PatientSummary): boolean =>
  patientSummaryKeys.some((key) => Boolean(normalizeText(summary[key])));

export const isStructuredSummaryPopulated = (summary: StructuredSummary): boolean =>
  sectionOrder.some((key) => Boolean(normalizeText(summary[key])));

/** Minimal paired plain register for builders/tests when patientSummary is omitted. */
export const buildDefaultPatientSummaryForClinical = (structuredSummary: StructuredSummary): PatientSummary => {
  if (!isStructuredSummaryPopulated(structuredSummary)) {
    return createEmptyPatientSummary();
  }

  const overview = [structuredSummary.chief_concern, structuredSummary.key_report_findings]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' ');
  const whatToDiscuss = [structuredSummary.red_flags_to_discuss, structuredSummary.follow_up_discussion_points]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' ');

  return {
    overview: overview || 'Your records include findings your specialist will review with you.',
    what_to_discuss:
      whatToDiscuss || 'Please discuss these findings and next steps with your specialist.',
    not_a_diagnosis:
      'This is not a diagnosis. Your specialist reviews the full records and decides what it means for you.',
  };
};

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
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);

const getReportChunks = (report: ExtractedReport): string[] => {
  const chunks = report.text
    .split(/[.!?\n]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 12);

  const proseChunks = chunks.filter((chunk) => isProseLikeEvidenceSnippet(chunk));
  if (proseChunks.length > 0) {
    return proseChunks;
  }

  // Fallback: keep chunks that are not obvious chrome (need some lowercase density).
  return chunks.filter((chunk) => {
    if (isNavOrOcrJunkSnippet(chunk)) {
      return false;
    }
    const letters = chunk.replace(/[^a-zA-Z]/g, '');
    if (!letters) {
      return false;
    }
    const lowercase = (chunk.match(/[a-z]/g) || []).length;
    return lowercase / letters.length >= 0.15;
  });
};

const scoreChunkOverlap = (sectionWords: string[], chunk: string): number => {
  const normalizedChunk = normalizeForMatch(chunk);
  let score = sectionWords.filter((word) => normalizedChunk.includes(word)).length;
  if (isProseLikeEvidenceSnippet(chunk)) {
    score += 1;
  }
  return score;
};

const matchEvidenceInReports = (
  sectionText: string,
  reports: ExtractedReport[],
  minOverlap: number
): { fileId: string; fileName: string; snippet: string } | null => {
  const normalizedSection = normalizeForMatch(sectionText);
  if (!normalizedSection || reports.length === 0) {
    return null;
  }

  const sectionCandidates = [sectionText, ...sectionText.split(/[.!?]+/).map((part) => part.trim())].filter(
    (candidate) => candidate.length >= 12
  );
  const sectionWords = tokenizeForOverlap(sectionText);
  const requiredOverlap = Math.max(minOverlap, Math.min(2, Math.max(1, sectionWords.length)));
  let bestMatch: { fileId: string; fileName: string; snippet: string; score: number } | null = null;

  for (const report of reports) {
    const normalizedReport = normalizeForMatch(report.text);

    for (const candidate of sectionCandidates) {
      const normalizedCandidate = normalizeForMatch(candidate);
      if (normalizedCandidate.length >= 12 && normalizedReport.includes(normalizedCandidate.slice(0, 120))) {
        const startIndex = normalizedReport.indexOf(normalizedCandidate.slice(0, 120));
        const rawSnippet = report.text.slice(startIndex, startIndex + 220).trim();
        const snippet = rawSnippet || candidate.slice(0, 220);
        if (isNavOrOcrJunkSnippet(snippet) && !isProseLikeEvidenceSnippet(snippet)) {
          continue;
        }
        return {
          fileId: report.fileId,
          fileName: report.fileName,
          snippet,
        };
      }
    }

    for (const chunk of getReportChunks(report)) {
      const overlap = scoreChunkOverlap(sectionWords, chunk);
      if (overlap < requiredOverlap) {
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

export const findGroundedEvidenceSnippet = (
  sectionText: string,
  reports: ExtractedReport[]
): { fileId: string; fileName: string; snippet: string } | null => {
  return matchEvidenceInReports(sectionText, reports, 1);
};

export const findBestEffortEvidenceSnippet = (
  sectionText: string,
  reports: ExtractedReport[]
): { fileId: string; fileName: string; snippet: string } | null => {
  const grounded = matchEvidenceInReports(sectionText, reports, 1);
  if (grounded) {
    return grounded;
  }

  const sectionWords = tokenizeForOverlap(sectionText);
  let bestMatch: { fileId: string; fileName: string; snippet: string; score: number } | null = null;

  for (const report of reports) {
    for (const chunk of getReportChunks(report)) {
      const overlap = scoreChunkOverlap(sectionWords, chunk);
      if (overlap === 0) {
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

  if (bestMatch) {
    return {
      fileId: bestMatch.fileId,
      fileName: bestMatch.fileName,
      snippet: bestMatch.snippet,
    };
  }

  for (const report of reports) {
    const chunks = getReportChunks(report);
    if (chunks.length > 0) {
      return {
        fileId: report.fileId,
        fileName: report.fileName,
        snippet: chunks[0].slice(0, 220),
      };
    }

    const trimmed = report.text.trim();
    if (trimmed.length >= 12 && !isNavOrOcrJunkSnippet(trimmed)) {
      return {
        fileId: report.fileId,
        fileName: report.fileName,
        snippet: trimmed.slice(0, 220),
      };
    }
  }

  return null;
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

      const grounded =
        findGroundedEvidenceSnippet(content, reports) ?? findBestEffortEvidenceSnippet(content, reports);
      if (!grounded) {
        return null;
      }

      // Drop non-prose / PDF-operator snippets; keep original text for groundedness.
      if (!sanitizeEvidenceSnippetForCitation(grounded.snippet)) {
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
  patientSummary?: PatientSummary | null;
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

  const patientSummary =
    input.patientSummary === undefined
      ? buildDefaultPatientSummaryForClinical(structuredSummary)
      : normalizePatientSummary(input.patientSummary);

  const questions = input.specialistQuestions.map((question, index) => ({
    id: `q${index + 1}`,
    question: normalizeText(question),
  }));

  return {
    structured_summary: structuredSummary,
    patient_summary: patientSummary,
    questionnaire: {
      specialist_questions: questions,
    },
    confidence_score: clampConfidenceScore(input.confidenceScore),
    uncertainty_flags: normalizeUncertaintyFlags(input.uncertaintyFlags),
    disclaimer: normalizeText(input.disclaimer) || defaultMedicalDisclaimer,
    evidence_refs: buildEvidenceRefs(structuredSummary, input.reports),
    citations: [],
    trialMatches: [],
    citation_links: [],
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

/** Legacy artifacts may omit patient_summary; treat as hydrateable if clinical shape is present. */
const isLegacyOrCurrentCaseAnalysisArtifact = (value: unknown): boolean => {
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
  if (isLegacyOrCurrentCaseAnalysisArtifact(input.artifact)) {
    const artifact = input.artifact as CaseAnalysisArtifact & { patient_summary?: unknown };
    return {
      ...artifact,
      patient_summary: normalizePatientSummary(artifact.patient_summary),
      uncertainty_flags: Array.isArray(artifact.uncertainty_flags) ? artifact.uncertainty_flags : [],
      evidence_refs: Array.isArray(artifact.evidence_refs)
        ? artifact.evidence_refs.filter((ref) => !isNavOrOcrJunkSnippet(ref.snippet || ''))
        : [],
      citations: Array.isArray(artifact.citations) ? artifact.citations : [],
      trialMatches: Array.isArray(artifact.trialMatches) ? artifact.trialMatches : [],
      citation_links: Array.isArray(artifact.citation_links) ? artifact.citation_links : [],
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
