import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { resolveUploadDir } from '../utils/uploadPath';
import {
  artifactQuestionsToStrings,
  hydrateCaseAnalysisArtifact,
} from './analysisArtifact.service';
import type { DoctorOpinionKeyImage } from './doctorOpinionPdf.service';
import {
  DoctorKeyImage,
  DoctorResponseDraft,
  DoctorResponseSendPayload,
  RecordsReviewedItem,
  parseDoctorResponseDraft,
} from '../schemas/doctorResponse.schema';

export interface ResolvedSpecialistQuestion {
  id: string;
  question: string;
}

/** Standard remote records-only review caveats — specialist may edit before send. */
export const DEFAULT_REMOTE_REVIEW_LIMITATIONS = [
  'This is a remote, records-only second opinion. I have not examined you in person.',
  'Findings and recommendations are based solely on the materials available at the time of review.',
  'This review does not replace ongoing care with your treating clinicians, and it is not an emergency service.',
  'If your symptoms change or worsen, seek prompt in-person medical attention.',
].join(' ');

export interface CaseFileForRecordsReviewed {
  original_filename?: string | null;
  filename?: string | null;
  file_type?: string | null;
  mime_type?: string | null;
}

export interface ImagingStudyForRecordsReviewed {
  study_description?: string | null;
  modality?: string | null;
  series_count?: number | null;
  patient_name?: string | null;
}

/** Derive a default records-reviewed list from case files + imaging studies. */
export const buildRecordsReviewedFromCase = (
  files: CaseFileForRecordsReviewed[] = [],
  imagingStudies: ImagingStudyForRecordsReviewed[] = []
): RecordsReviewedItem[] => {
  const reports: RecordsReviewedItem[] = [];
  for (const file of files) {
    const name = (file.original_filename || file.filename || '').trim();
    if (!name) {
      continue;
    }
    const meta = [file.file_type, file.mime_type].filter(Boolean).join(' · ') || undefined;
    reports.push({ name, kind: 'report', meta, confirmed: false });
  }

  const imaging: RecordsReviewedItem[] = [];
  for (const study of imagingStudies) {
    const name = (study.study_description || study.modality || 'Imaging study').trim();
    if (!name) {
      continue;
    }
    const metaParts: string[] = [];
    if (study.modality?.trim()) {
      metaParts.push(study.modality.trim());
    }
    if (study.series_count != null && Number.isFinite(Number(study.series_count))) {
      metaParts.push(`${study.series_count} series`);
    }
    imaging.push({
      name,
      kind: 'imaging',
      meta: metaParts.length ? metaParts.join(' · ') : undefined,
      confirmed: false,
    });
  }

  return [...reports, ...imaging];
};

const emptyDraft = (): DoctorResponseDraft => ({
  questionAnswers: [],
  summary: '',
  recordsReviewed: [],
  clinicalSummary: '',
  assessment: '',
  concordance: null,
  recommendations: '',
  limitations: '',
});

/** Keep summary ↔ recommendations dual-write in sync when merging drafts. */
const syncSummaryAndRecommendations = (
  parsed: DoctorResponseDraft,
  current: DoctorResponseDraft
): { summary: string; recommendations: string } => {
  const parsedRec = (parsed.recommendations || '').trim();
  const parsedSum = (parsed.summary || '').trim();
  const currentRec = (current.recommendations || '').trim();
  const currentSum = (current.summary || '').trim();

  if (parsedRec) {
    return { recommendations: parsedRec, summary: parsedRec };
  }
  if (parsedSum) {
    return { recommendations: parsedSum, summary: parsedSum };
  }
  // Neither provided in this PUT — preserve existing dual-write values.
  const preserved = currentRec || currentSum;
  return { recommendations: preserved, summary: preserved };
};

export interface CaseRowForQuestionResolution {
  specialist_questions?: string[] | null;
  analysis_questions?: string[] | null;
  analysis_artifact?: unknown;
  analysis_summary?: string | null;
  analysis_model?: string | null;
  share_ai_analysis_with_specialists?: boolean | null;
}

const parsePatientSpecialistQuestions = (input: unknown): string[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

export const resolveSpecialistQuestions = (
  caseRow: CaseRowForQuestionResolution
): ResolvedSpecialistQuestion[] => {
  const patientQuestions = parsePatientSpecialistQuestions(caseRow.specialist_questions);

  if (patientQuestions.length > 0) {
    return patientQuestions.map((question, index) => ({
      id: `sq-${index + 1}`,
      question,
    }));
  }

  if (caseRow.share_ai_analysis_with_specialists === false) {
    return [];
  }

  const artifact = hydrateCaseAnalysisArtifact({
    artifact: caseRow.analysis_artifact,
    summary: caseRow.analysis_summary ?? null,
    questions: caseRow.analysis_questions ?? null,
    model: caseRow.analysis_model ?? null,
  });

  if (artifact?.questionnaire?.specialist_questions?.length) {
    return artifact.questionnaire.specialist_questions.map((item, index) => ({
      id: item.id || `aq-${index + 1}`,
      question: item.question,
    }));
  }

  const analysisQuestions = Array.isArray(caseRow.analysis_questions)
    ? caseRow.analysis_questions
        .filter((question): question is string => typeof question === 'string' && Boolean(question.trim()))
    : [];

  if (analysisQuestions.length > 0) {
    return analysisQuestions.map((question, index) => ({
      id: `aq-${index + 1}`,
      question: question.trim(),
    }));
  }

  if (artifact) {
    return artifactQuestionsToStrings(artifact).map((question, index) => ({
      id: `aq-${index + 1}`,
      question,
    }));
  }

  return [];
};

const getDoctorIdForUser = async (userId: string): Promise<string> => {
  const result = await query('SELECT id FROM doctors WHERE user_id = $1', [userId]);

  if (result.rows.length === 0) {
    throw new AppError('Doctor profile not found', 404);
  }

  return result.rows[0].id as string;
};

const fetchCaseRowForDoctor = async (caseId: string, doctorUserId: string) => {
  const result = await query(
    `SELECT c.id,
            c.specialist_questions,
            c.analysis_questions,
            c.analysis_artifact,
            c.analysis_summary,
            c.analysis_model,
            c.share_ai_analysis_with_specialists,
            ca.response_draft
     FROM cases c
     JOIN case_assignments ca ON ca.case_id = c.id
     JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1 AND d.user_id = $2
     LIMIT 1`,
    [caseId, doctorUserId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Case not found for assigned doctor', 404);
  }

  return result.rows[0] as CaseRowForQuestionResolution & { response_draft: unknown };
};

export const getDoctorResponse = async (caseId: string, doctorUserId: string) => {
  const row = await fetchCaseRowForDoctor(caseId, doctorUserId);
  const resolvedQuestions = resolveSpecialistQuestions(row);

  let draft: DoctorResponseDraft | null = null;
  if (row.response_draft && typeof row.response_draft === 'object') {
    draft = parseDoctorResponseDraft(row.response_draft);
  }

  // Seed citations/trials from analysis artifact when draft has none yet (SEC-206).
  const artifact = hydrateCaseAnalysisArtifact({
    artifact: row.analysis_artifact,
    summary: row.analysis_summary ?? null,
    questions: row.analysis_questions ?? null,
    model: row.analysis_model ?? null,
  });

  if (artifact && (artifact.citations?.length || artifact.trialMatches?.length)) {
    const seeded: DoctorResponseDraft = draft || emptyDraft();
    if (!seeded.citations?.length && artifact.citations?.length) {
      seeded.citations = artifact.citations.map((c) => ({
        id: c.id,
        source: 'pubmed' as const,
        pmid: c.pmid,
        title: c.title,
        journal: c.journal,
        year: c.year,
        url: c.url,
        relevanceNote: c.relevanceNote,
        kept: true,
      }));
    }
    if (!seeded.trialMatches?.length && artifact.trialMatches?.length) {
      seeded.trialMatches = artifact.trialMatches.map((t) => ({
        id: t.id,
        source: 'clinicaltrials' as const,
        nctId: t.nctId,
        title: t.title,
        phase: t.phase,
        status: t.status,
        url: t.url,
        eligibilitySummary: t.eligibilitySummary,
        kept: true,
      }));
    }
    draft = seeded;
  }

  return {
    resolvedQuestions,
    draft,
  };
};

export const saveDoctorResponseDraft = async (
  caseId: string,
  doctorUserId: string,
  payload: unknown
): Promise<DoctorResponseDraft> => {
  const parsed = parseDoctorResponseDraft(payload);
  const doctorId = await getDoctorIdForUser(doctorUserId);

  const existing = await query(
    `SELECT response_draft
     FROM case_assignments
     WHERE case_id = $1 AND doctor_id = $2`,
    [caseId, doctorId]
  );

  if (existing.rows.length === 0) {
    throw new AppError('Case not found for assigned doctor', 404);
  }

  const currentDraft =
    existing.rows[0].response_draft && typeof existing.rows[0].response_draft === 'object'
      ? parseDoctorResponseDraft(existing.rows[0].response_draft)
      : emptyDraft();

  const mergedAnswers = new Map(
    currentDraft.questionAnswers.map((item) => [item.questionId, item])
  );

  for (const item of parsed.questionAnswers) {
    mergedAnswers.set(item.questionId, item);
  }

  const { summary, recommendations } = syncSummaryAndRecommendations(parsed, currentDraft);

  const nextDraft: DoctorResponseDraft = {
    questionAnswers: Array.from(mergedAnswers.values()),
    summary,
    recommendations,
    status: parsed.status ?? currentDraft.status,
    // Client owns the full key-image list (append/remove locally, then PUT).
    keyImages: parsed.keyImages ?? currentDraft.keyImages ?? [],
    // Client owns the AI-draft baseline map (captured on Insert AI draft).
    aiDraftBaselines: parsed.aiDraftBaselines ?? currentDraft.aiDraftBaselines,
    // Preserve structured report sections when omitted / empty on partial PUT.
    recordsReviewed:
      parsed.recordsReviewed && parsed.recordsReviewed.length > 0
        ? parsed.recordsReviewed
        : currentDraft.recordsReviewed ?? [],
    clinicalSummary:
      parsed.clinicalSummary !== '' ? parsed.clinicalSummary : currentDraft.clinicalSummary || '',
    assessment: parsed.assessment !== '' ? parsed.assessment : currentDraft.assessment || '',
    concordance:
      parsed.concordance !== undefined && parsed.concordance !== null
        ? parsed.concordance
        : currentDraft.concordance ?? null,
    limitations: parsed.limitations !== '' ? parsed.limitations : currentDraft.limitations || '',
    // Client owns citation keep/drop lists (omit preserves existing).
    citations: parsed.citations ?? currentDraft.citations,
    trialMatches: parsed.trialMatches ?? currentDraft.trialMatches,
    droppedCitationIds: parsed.droppedCitationIds ?? currentDraft.droppedCitationIds,
    droppedTrialIds: parsed.droppedTrialIds ?? currentDraft.droppedTrialIds,
  };

  await query(
    `UPDATE case_assignments
     SET response_draft = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE case_id = $1 AND doctor_id = $2`,
    [caseId, doctorId, JSON.stringify({ ...nextDraft, updatedAt: new Date().toISOString() })]
  );

  return nextDraft;
};

export const validateDoctorResponseForSend = (
  resolvedQuestions: ResolvedSpecialistQuestion[],
  payload: DoctorResponseSendPayload
): void => {
  if (!payload.clinicalSummary?.trim()) {
    throw new AppError('clinicalSummary is required', 400);
  }
  if (!payload.assessment?.trim()) {
    throw new AppError('assessment is required', 400);
  }
  if (!payload.limitations?.trim()) {
    throw new AppError('limitations is required', 400);
  }
  if (!payload.concordance?.level) {
    throw new AppError('concordance level is required', 400);
  }
  if (!payload.concordance.rationale?.trim()) {
    throw new AppError('concordance rationale is required', 400);
  }

  const recommendations = (payload.recommendations || '').trim() || (payload.summary || '').trim();
  if (!recommendations) {
    throw new AppError('recommendations or summary is required', 400);
  }

  if (resolvedQuestions.length === 0) {
    return;
  }

  const answersById = new Map(
    payload.questionAnswers.map((item) => [item.questionId, item.answer.trim()])
  );

  for (const question of resolvedQuestions) {
    const answer = answersById.get(question.id);
    if (!answer) {
      throw new AppError(`Answer required for question: ${question.question}`, 400);
    }
  }

  if (payload.questionAnswers.length < resolvedQuestions.length) {
    throw new AppError('All patient questions must be answered before sending', 400);
  }
};

export const clearDoctorResponseDraft = async (caseId: string, doctorUserId: string): Promise<void> => {
  const doctorId = await getDoctorIdForUser(doctorUserId);

  await query(
    `UPDATE case_assignments
     SET response_draft = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE case_id = $1 AND doctor_id = $2`,
    [caseId, doctorId]
  );
};

const concordanceLevelLabel = (
  level: 'agree' | 'partially_agree' | 'disagree'
): string => {
  switch (level) {
    case 'agree':
      return 'We agree with your current diagnosis';
    case 'partially_agree':
      return 'We partially agree with your current diagnosis';
    case 'disagree':
      return 'We disagree with your current diagnosis';
    default:
      return level;
  }
};

export const composeDoctorOpinionContent = (payload: DoctorResponseSendPayload): string => {
  const sections: string[] = [];
  const recommendations =
    (payload.recommendations || '').trim() || (payload.summary || '').trim();

  if (payload.recordsReviewed && payload.recordsReviewed.length > 0) {
    sections.push('What we reviewed');
    payload.recordsReviewed.forEach((item) => {
      const meta = item.meta?.trim() ? ` (${item.meta.trim()})` : '';
      sections.push(`- ${item.name}${meta}`);
    });
  }

  if (payload.clinicalSummary?.trim()) {
    sections.push('Your case in brief');
    sections.push(payload.clinicalSummary.trim());
  }

  if (payload.assessment?.trim()) {
    sections.push('What your records show');
    sections.push(payload.assessment.trim());
  }

  if (payload.concordance?.level) {
    sections.push('Do we agree with your current diagnosis');
    sections.push(concordanceLevelLabel(payload.concordance.level));
    if (payload.concordance.rationale?.trim()) {
      sections.push(payload.concordance.rationale.trim());
    }
  }

  if (recommendations) {
    sections.push('What to do next');
    sections.push(recommendations);
  }

  if (payload.questionAnswers.length > 0) {
    sections.push('Your questions, answered');
    payload.questionAnswers.forEach((item, index) => {
      sections.push(`${index + 1}. ${item.question}`);
      sections.push(item.answer.trim());
    });
  }

  if (payload.limitations?.trim()) {
    sections.push('What this review does and doesn\'t cover');
    sections.push(payload.limitations.trim());
  }

  // Legacy fallback when only summary / clinicalResponse-era content exists.
  if (sections.length === 0 && payload.summary?.trim()) {
    sections.push('What to do next');
    sections.push(payload.summary.trim());
  }

  return sections.join('\n\n');
};

export const formatKeyImageLabel = (image: DoctorKeyImage): string => {
  const series = image.seriesDescription?.trim() || image.seriesUid;
  const slice =
    image.instanceNumber != null && Number.isFinite(image.instanceNumber)
      ? String(image.instanceNumber)
      : 'n/a';
  const caption = image.caption?.trim();
  const base = `Series: ${series}; slice: ${slice}`;
  return caption ? `${base} — ${caption}` : base;
};

export const resolveKeyImagesForPdf = (
  keyImages: DoctorKeyImage[] | undefined
): DoctorOpinionKeyImage[] => {
  if (!keyImages || keyImages.length === 0) {
    return [];
  }

  const uploadDir = resolveUploadDir();
  return keyImages
    .map((image) => {
      const filePath = path.join(uploadDir, path.basename(image.filename));
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return {
        filePath,
        label: formatKeyImageLabel(image),
      };
    })
    .filter((item): item is DoctorOpinionKeyImage => Boolean(item));
};

export const appendDoctorKeyImage = async (
  caseId: string,
  doctorUserId: string,
  input: {
    filename: string;
    mimeType: string;
    seriesUid: string;
    seriesDescription?: string | null;
    instanceNumber?: number | null;
    sopInstanceUid?: string | null;
    sourceFileId?: string | null;
    caption?: string;
  }
): Promise<{ draft: DoctorResponseDraft; keyImage: DoctorKeyImage }> => {
  const existing = await getDoctorResponse(caseId, doctorUserId);
  const currentDraft = existing.draft || { ...emptyDraft(), keyImages: [] };

  const keyImage: DoctorKeyImage = {
    id: uuidv4(),
    filename: path.basename(input.filename),
    mimeType: input.mimeType || 'image/png',
    seriesUid: input.seriesUid,
    seriesDescription: input.seriesDescription ?? null,
    instanceNumber: input.instanceNumber ?? null,
    sopInstanceUid: input.sopInstanceUid ?? null,
    sourceFileId: input.sourceFileId ?? null,
    caption: input.caption,
    capturedAt: new Date().toISOString(),
  };

  const nextDraft = await saveDoctorResponseDraft(caseId, doctorUserId, {
    questionAnswers: currentDraft.questionAnswers,
    summary: currentDraft.summary,
    recommendations: currentDraft.recommendations,
    clinicalSummary: currentDraft.clinicalSummary,
    assessment: currentDraft.assessment,
    concordance: currentDraft.concordance,
    limitations: currentDraft.limitations,
    recordsReviewed: currentDraft.recordsReviewed,
    status: currentDraft.status,
    keyImages: [...(currentDraft.keyImages || []), keyImage],
    aiDraftBaselines: currentDraft.aiDraftBaselines,
  });

  return { draft: nextDraft, keyImage };
};
