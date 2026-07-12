import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import {
  artifactQuestionsToStrings,
  hydrateCaseAnalysisArtifact,
} from './analysisArtifact.service';
import {
  DoctorResponseDraft,
  DoctorResponseSendPayload,
  parseDoctorResponseDraft,
} from '../schemas/doctorResponse.schema';

export interface ResolvedSpecialistQuestion {
  id: string;
  question: string;
}

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
      : { questionAnswers: [], summary: '' };

  const mergedAnswers = new Map(
    currentDraft.questionAnswers.map((item) => [item.questionId, item])
  );

  for (const item of parsed.questionAnswers) {
    mergedAnswers.set(item.questionId, item);
  }

  const nextDraft: DoctorResponseDraft = {
    questionAnswers: Array.from(mergedAnswers.values()),
    summary: parsed.summary !== '' ? parsed.summary : currentDraft.summary,
    status: parsed.status ?? currentDraft.status,
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
  if (!payload.summary.trim()) {
    throw new AppError('summary is required', 400);
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

export const composeDoctorOpinionContent = (payload: DoctorResponseSendPayload): string => {
  const sections: string[] = [];

  if (payload.questionAnswers.length > 0) {
    sections.push('Patient Questions & Specialist Responses');
    payload.questionAnswers.forEach((item, index) => {
      sections.push(`${index + 1}. ${item.question}`);
      sections.push(item.answer.trim());
    });
  }

  sections.push('Clinical Summary & Recommendations');
  sections.push(payload.summary.trim());

  return sections.join('\n\n');
};
