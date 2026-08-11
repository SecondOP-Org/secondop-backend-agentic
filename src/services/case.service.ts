import { QueryResultRow } from 'pg';
import { transaction } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { AuthUserType } from '../middleware/auth';
import { extractObservationsFromSummary } from './analysis.service';
import {
  artifactQuestionsToStrings,
  extractObservationsFromArtifact,
  hydrateCaseAnalysisArtifact,
  QuestionnaireItem,
} from './analysisArtifact.service';
import { reidentifyArtifact } from './analysisDeidentification.service';
import { recordAnalysisPiiRevealEvent } from './analysisPiiRevealAudit.service';
import { clearDeidVaultsForCase, isDeidVaultAvailable, loadDeidVaultMapping } from './deidVault.service';
import {
  parseAndValidateSpecialistQuestionsUpdate,
  parseFlexibleQuestionnaireItems,
  questionnaireItemsToStrings,
} from './specialistQuestions.validation';
import { toLegacyExecutionMode } from '../agentic/core/executionMode';
import { getLatestAnalysisRun, getLatestAnalysisRunByEngine, getLatestShadowResultByCaseId } from './analysisRun.service';
import { getCaseRunTrace } from '../agentic/observability/analysisObservability.service';
import { analysisWorker } from './analysisWorker.service';
import { getImagingStudiesForCase } from './dicomImaging.service';
import {
  buildDoctorOpinionOriginalName,
  generateDoctorOpinionPdf,
  generateDoctorOpinionPdfBuffer,
} from './doctorOpinionPdf.service';
import {
  clearDoctorResponseDraft,
  composeDoctorOpinionContent,
  resolveKeyImagesForPdf,
  resolveSpecialistQuestions,
  validateDoctorResponseForSend,
} from './doctorResponse.service';
import { recordAiDraftEditRatioOnSend } from './doctorEditDistance.service';
import {
  ensureDoctorCredentialVerifiedByDoctorId,
  ensureDoctorCredentialVerifiedByUserId,
} from './doctorVerification.service';
import {
  isStructuredDoctorResponsePayload,
  parseDoctorResponseDraft,
  parseDoctorResponseSend,
} from '../schemas/doctorResponse.schema';
import { parsePatientFacingDraftRequest } from '../schemas/patientFacingDraft.schema';
import {
  generatePatientFacingDraftForCase,
  streamPatientFacingDraftForCase,
} from './patientFacingDraft.service';
import {
  getLatestCaseSymptomIntake,
  parseOptionalSymptomIntake,
  upsertCaseSymptomIntake,
} from './caseSymptomIntake.service';
import { generateCaseNumber } from '../utils/caseNumber';
import { resolveCaseId } from '../utils/caseIdentifier';
import { paginationMeta, parsePaginationQuery, splitTotalCount } from '../utils/pagination';
import {
  DOCTOR_INBOX_CASE_STATUSES,
  DEFAULT_TURNAROUND_DAYS,
  isDueToday,
  isOverdue,
  resolveEffectiveDueDate,
} from './doctorCaseInbox.service';
import logger from '../utils/logger';
import * as caseRepository from '../repositories/case.repository';

interface IntakePayload {
  age: number;
  sex: string;
  specialtyContext: string;
  symptoms: string;
  symptomDuration: string;
  medicalHistory: string;
  currentMedications: string;
  allergies: string;
}

export type CaseRowWithAiSharing = Record<string, unknown> & {
  share_ai_analysis_with_specialists?: boolean | null;
};

const assertNonEmptyString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${fieldName} is required`, 400);
  }

  return value.trim();
};

/** Optional free-text; missing/blank becomes empty string (symptoms are not required). */
const optionalString = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

export const parseIntake = (input: unknown): IntakePayload => {
  if (!input || typeof input !== 'object') {
    throw new AppError('intake is required', 400);
  }

  const ageValue = (input as { age?: unknown }).age;
  const age = Number(ageValue);

  if (!Number.isFinite(age) || age < 0 || age > 130) {
    throw new AppError('intake.age must be between 0 and 130', 400);
  }

  return {
    age,
    sex: assertNonEmptyString((input as { sex?: unknown }).sex, 'intake.sex'),
    specialtyContext: assertNonEmptyString(
      (input as { specialtyContext?: unknown }).specialtyContext,
      'intake.specialtyContext'
    ),
    symptoms: optionalString((input as { symptoms?: unknown }).symptoms),
    symptomDuration: optionalString((input as { symptomDuration?: unknown }).symptomDuration),
    medicalHistory: assertNonEmptyString(
      (input as { medicalHistory?: unknown }).medicalHistory,
      'intake.medicalHistory'
    ),
    currentMedications: assertNonEmptyString(
      (input as { currentMedications?: unknown }).currentMedications,
      'intake.currentMedications'
    ),
    allergies: assertNonEmptyString((input as { allergies?: unknown }).allergies, 'intake.allergies'),
  };
};

const getPatientIdForUser = async (userId: string): Promise<string> => {
  const patientResult = await caseRepository.findPatientIdByUserId(userId);

  if (patientResult.length === 0) {
    throw new AppError('Patient profile not found', 404);
  }

  return patientResult[0].id as string;
};

export const ensurePatientOwnsCase = async (caseId: string, userId: string): Promise<void> => {
  const result = await caseRepository.findPatientOwnsCase(caseId, userId);

  if (result.length === 0) {
    throw new AppError('You do not have access to this case', 403);
  }
};

export const ensureDoctorAssignedToCase = async (caseId: string, userId: string): Promise<void> => {
  const result = await caseRepository.findDoctorAssignedToCase(caseId, userId);

  if (result.length === 0) {
    throw new AppError('You do not have access to this case', 403);
  }
};

export const ensureCaseAccess = async (
  caseId: string,
  userId: string,
  userType: AuthUserType
): Promise<void> => {
  if (userType === 'organization') {
    throw new AppError('Organization accounts cannot access clinical cases', 403);
  }

  if (userType === 'patient') {
    await ensurePatientOwnsCase(caseId, userId);
    return;
  }

  await ensureDoctorAssignedToCase(caseId, userId);
};

export const parseSpecialistQuestions = (input: unknown): string[] => {
  if (!Array.isArray(input) || input.length !== 3) {
    throw new AppError('specialistQuestions must contain exactly 3 items', 400);
  }

  return input.map((value, index) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new AppError(`specialistQuestions[${index}] must be a non-empty string`, 400);
    }

    return value.trim();
  });
};

const parseFlexibleSpecialistQuestions = (input: unknown): QuestionnaireItem[] =>
  parseFlexibleQuestionnaireItems(input, { source: 'patient' });

const buildSpecialistQuestionsDetailed = (
  caseRow: { specialist_questions?: unknown; analysis_questions?: string[] | null; analysis_artifact?: unknown; analysis_summary?: string | null; analysis_model?: string | null; share_ai_analysis_with_specialists?: boolean | null }
): QuestionnaireItem[] => {
  const resolved = resolveSpecialistQuestions(caseRow);
  return resolved.map((item) => ({
    id: item.id,
    question: item.question,
    source: item.source,
    ...(item.edited ? { edited: true } : {}),
    ...(item.confirmed ? { confirmed: true } : {}),
  }));
};

/** Patient may confirm/edit questions only while the case is still a draft (pre-submit). */
const ensurePatientOwnsDraftCaseForQuestions = async (caseId: string, userId: string): Promise<void> => {
  await ensurePatientOwnsCase(caseId, userId);
  const rows = await caseRepository.findCaseById(caseId);
  if (rows.length === 0) {
    throw new AppError('Case not found', 404);
  }
  const status = String((rows[0] as { status?: string }).status || '');
  if (status !== 'draft') {
    throw new AppError('Specialist questions can only be edited while the case is still a draft', 403);
  }
};

const parseShareAiAnalysisWithSpecialists = (input: unknown): boolean => {
  if (input === undefined || input === null) {
    return true;
  }

  if (typeof input === 'boolean') {
    return input;
  }

  throw new AppError('shareAiAnalysisWithSpecialists must be a boolean', 400);
};

const redactAiAnalysisForDoctor = <T extends CaseRowWithAiSharing>(row: T): T => ({
  ...row,
  analysis_status: 'not_started',
  analysis_summary: null,
  analysis_artifact: null,
  analysis_questions: null,
  analysis_model: null,
  analysis_error: null,
});

export const sanitizeCaseRowForViewer = <T extends CaseRowWithAiSharing>(
  row: T,
  userType: AuthUserType
): T => {
  if (userType === 'doctor' && row.share_ai_analysis_with_specialists === false) {
    return redactAiAnalysisForDoctor(row);
  }

  return row;
};

const mapDoctorInboxCaseRow = (row: CaseRowWithAiSharing) => {
  const sanitized = sanitizeCaseRowForViewer(row, 'doctor');
  const effectiveDueDate = resolveEffectiveDueDate(
    row.due_date as string | Date | null | undefined,
    row.submitted_date as string | Date | null | undefined
  );

  return {
    ...sanitized,
    due_date: effectiveDueDate ? effectiveDueDate.toISOString() : sanitized.due_date,
    is_overdue: isOverdue(effectiveDueDate, String(row.status || '')),
  };
};

const normalizeSubmittedDate = (value: string | Date | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
};

const getDoctorIdForUser = async (userId: string): Promise<string> => {
  const doctorResult = await caseRepository.findDoctorIdByUserId(userId);
  if (doctorResult.length === 0) {
    throw new AppError('Doctor profile not found', 404);
  }
  return doctorResult[0].id as string;
};

type DoctorOpinionCaseRow = QueryResultRow & {
  title: string;
  case_number: string;
  submitted_date: string | Date | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  doctor_first_name: string | null;
  doctor_last_name: string | null;
  doctor_specialty: string | null;
  doctor_license_number: string | null;
  patient_age: unknown;
  patient_sex: string | null;
  share_ai_analysis_with_specialists: boolean | null;
  analysis_status: string;
};

const buildDoctorOpinionNames = (row: DoctorOpinionCaseRow) => {
  const patientName =
    `${row.patient_first_name || ''} ${row.patient_last_name || ''}`.trim() || 'Patient';
  const doctorName =
    `${row.doctor_first_name || ''} ${row.doctor_last_name || ''}`.trim() || 'Specialist';
  const patientAge =
    row.patient_age == null || Number.isNaN(Number(row.patient_age))
      ? null
      : Number(row.patient_age);

  return { patientName, doctorName, patientAge };
};

const buildStructuredPdfInput = (
  row: DoctorOpinionCaseRow,
  payload: ReturnType<typeof parseDoctorResponseDraft> | ReturnType<typeof parseDoctorResponseSend>,
  options: { isDraft: boolean; signedAt?: string }
): Parameters<typeof generateDoctorOpinionPdfBuffer>[0] => {
  const { patientName, doctorName, patientAge } = buildDoctorOpinionNames(row);
  const recommendations =
    (payload.recommendations || '').trim() || (payload.summary || '').trim();
  const keptCitations = (payload.citations || []).filter((c) => c.kept !== false);
  const keptTrials = (payload.trialMatches || []).filter((t) => t.kept !== false);

  return {
    caseTitle: row.title,
    caseNumber: row.case_number,
    patientName,
    patientFirstName: row.patient_first_name || null,
    doctorName,
    doctorSpecialty: row.doctor_specialty || '',
    doctorLicenseNumber: row.doctor_license_number || null,
    submittedDate: normalizeSubmittedDate(row.submitted_date),
    questionAnswers: payload.questionAnswers,
    summary: payload.summary,
    recommendations,
    clinicalSummary: payload.clinicalSummary,
    assessment: payload.assessment,
    concordance: payload.concordance ?? null,
    limitations: payload.limitations,
    recordsReviewed: payload.recordsReviewed || [],
    keyImages: resolveKeyImagesForPdf(payload.keyImages),
    aiAssistedReview:
      row.share_ai_analysis_with_specialists !== false && row.analysis_status === 'succeeded',
    patientAge,
    patientSex: row.patient_sex || null,
    isDraft: options.isDraft,
    signedAt: options.signedAt,
    citations: keptCitations.map((c) => ({
      id: c.id,
      title: c.title,
      journal: c.journal,
      year: c.year,
      url: c.url,
      pmid: c.pmid,
    })),
    trialMatches: keptTrials.map((t) => ({
      id: t.id,
      title: t.title,
      nctId: t.nctId,
      phase: t.phase,
      status: t.status,
      url: t.url,
    })),
  };
};

export const createCaseForPatient = async (userId: string, body: Record<string, unknown>) => {
  const patientId = await getPatientIdForUser(userId);

  const title = assertNonEmptyString(body.title, 'title');
  const description = typeof body.description === 'string' ? body.description : '';
  const specialty = assertNonEmptyString(body.specialty, 'specialty');
  const priority = typeof body.priority === 'string' ? body.priority : 'medium';
  const urgencyLevel = typeof body.urgencyLevel === 'string' ? body.urgencyLevel : 'moderate';
  const status = body.status === 'draft' ? 'draft' : 'pending';
  const intake = parseIntake(body.intake);
  const symptomIntake = parseOptionalSymptomIntake(body.symptomIntake);
  const caseNumber = generateCaseNumber();

  return transaction(async (client) => {
    const caseRow = await caseRepository.insertCase(
      {
        caseNumber,
        patientId,
        title,
        description,
        specialty,
        priority,
        urgencyLevel,
        status,
      },
      client
    );

    await caseRepository.insertCaseIntake(
      {
        caseId: caseRow.id as string,
        age: intake.age,
        sex: intake.sex,
        specialtyContext: intake.specialtyContext,
        symptoms: intake.symptoms,
        symptomDuration: intake.symptomDuration,
        medicalHistory: intake.medicalHistory,
        currentMedications: intake.currentMedications,
        allergies: intake.allergies,
      },
      client
    );

    if (symptomIntake) {
      await upsertCaseSymptomIntake(caseRow.id as string, symptomIntake, client);
    }

    return caseRow;
  });
};

export const updateCaseIntakeForPatient = async (
  caseId: string,
  userId: string,
  body: Record<string, unknown>
) => {
  await ensurePatientOwnsCase(caseId, userId);
  const intake = parseIntake(body.intake);
  const symptomIntake = parseOptionalSymptomIntake(body.symptomIntake);

  await caseRepository.upsertCaseIntake({
    caseId,
    age: intake.age,
    sex: intake.sex,
    specialtyContext: intake.specialtyContext,
    symptoms: intake.symptoms,
    symptomDuration: intake.symptomDuration,
    medicalHistory: intake.medicalHistory,
    currentMedications: intake.currentMedications,
    allergies: intake.allergies,
  });

  if (symptomIntake) {
    await upsertCaseSymptomIntake(caseId, symptomIntake);
  }

  if (typeof body.specialty === 'string' && body.specialty.trim()) {
    await caseRepository.updateCaseSpecialty(caseId, body.specialty.trim());
  }
};

export const queueCaseAnalysisForPatient = async (caseId: string, userId: string) => {
  await ensurePatientOwnsCase(caseId, userId);

  const intakeRows = await caseRepository.findCaseIntakeExists(caseId);
  if (intakeRows.length === 0) {
    throw new AppError('Case intake is required before analysis', 400);
  }

  const fileCount = await caseRepository.countEligibleMedicalFiles(caseId);
  if (fileCount < 1) {
    throw new AppError('At least one medical report (PDF or image) is required before analysis', 400);
  }

  const queued = await analysisWorker.queueCase(caseId);

  return {
    caseId,
    analysisStatus: queued.analysisStatus,
    analysisRunId: queued.analysisRunId,
  };
};

/** Owner-only PII reveal: patient who owns the case. Never grant to doctor/org/operator. */
export const canRevealPii = (userType: AuthUserType, ownsCase: boolean): boolean =>
  userType === 'patient' && ownsCase;

export const getCaseAnalysisForViewer = async (
  caseIdParam: string,
  userId: string,
  userType: AuthUserType,
  includeAgentic: boolean,
  isOperator: boolean,
  revealPii = false
) => {
  const caseId = await resolveCaseId(caseIdParam);
  await ensureCaseAccess(caseId, userId, userType);

  if (revealPii) {
    if (userType !== 'patient') {
      throw new AppError('Only the case owner can reveal PII', 403);
    }
    await ensurePatientOwnsCase(caseId, userId);
  }

  const rows = await caseRepository.findCaseAnalysisFields(caseId);
  if (rows.length === 0) {
    throw new AppError('Case not found', 404);
  }

  const row = rows[0] as {
    analysis_status: string;
    analysis_summary: string | null;
    analysis_questions: string[] | null;
    analysis_artifact: unknown;
    analysis_model: string | null;
    analysis_error: string | null;
    share_ai_analysis_with_specialists: boolean;
  };

  if (userType === 'doctor' && row.share_ai_analysis_with_specialists === false) {
    return {
      analysisStatus: 'not_started',
      summary: null,
      analysisQuestions: null,
      specialist_questions_detailed: [],
      artifact: null,
      error: null,
      analysisRunId: null,
      attentionReason: null,
      analysisRetrying: false,
      observations: null,
      aiAnalysisSharedWithSpecialists: false,
      pii_available: false,
      pii_revealed: false,
    };
  }

  const latestRun = await getLatestAnalysisRun(caseId);
  const analysisRetrying =
    row.analysis_status === 'processing' &&
    ((latestRun?.attempt_count ?? 1) > 1 ||
      (typeof row.analysis_error === 'string' &&
        row.analysis_error.toLowerCase().startsWith('retrying analysis')));

  let artifact = hydrateCaseAnalysisArtifact({
    artifact: row.analysis_artifact,
    summary: row.analysis_summary,
    questions: row.analysis_questions,
    model: row.analysis_model,
  });

  const runId = latestRun?.id || null;
  const piiAvailable = runId ? await isDeidVaultAvailable(runId) : false;
  let piiRevealed = false;

  if (revealPii && artifact && piiAvailable && runId) {
    const mapping = await loadDeidVaultMapping(runId);
    if (Object.keys(mapping).length > 0) {
      const reidentified = reidentifyArtifact(artifact, mapping);
      artifact = reidentified.artifact;
      piiRevealed = true;
      await recordAnalysisPiiRevealEvent({
        caseId,
        runId,
        actorUserId: userId,
        revealed: true,
      });
    }
  } else if (revealPii) {
    await recordAnalysisPiiRevealEvent({
      caseId,
      runId,
      actorUserId: userId,
      revealed: false,
    });
  }

  const observations =
    artifact
      ? extractObservationsFromArtifact(artifact)
      : typeof row.analysis_summary === 'string' && row.analysis_summary.trim()
        ? extractObservationsFromSummary(row.analysis_summary)
        : null;

  const payload: Record<string, unknown> = {
    analysisStatus: row.analysis_status,
    summary: artifact ? artifact.structured_summary.chief_concern || row.analysis_summary : row.analysis_summary,
    analysisQuestions: artifact ? artifactQuestionsToStrings(artifact) : row.analysis_questions,
    specialist_questions_detailed: artifact
      ? artifact.questionnaire.specialist_questions.map((item) => ({
          id: item.id,
          question: item.question,
          source: item.source ?? 'ai',
          ...(item.edited ? { edited: true } : {}),
          ...(item.confirmed ? { confirmed: true } : {}),
        }))
      : Array.isArray(row.analysis_questions)
        ? row.analysis_questions
            .filter((q): q is string => typeof q === 'string' && Boolean(q.trim()))
            .map((question, index) => ({
              id: `aq-${index + 1}`,
              question: question.trim(),
              source: 'ai' as const,
            }))
        : [],
    artifact,
    error: analysisRetrying ? null : row.analysis_error,
    analysisRunId: runId,
    attentionReason: latestRun?.attention_reason || null,
    analysisRetrying,
    observations,
    pii_available: piiAvailable,
    pii_revealed: piiRevealed,
  };

  if (includeAgentic) {
    if (!isOperator) {
      throw new AppError('Insufficient command-center permissions', 403);
    }

    const latestAgenticRun = await getLatestAnalysisRunByEngine(caseId, 'agentic');
    const latestShadow = await getLatestShadowResultByCaseId(caseId);

    payload.agenticRunId = latestAgenticRun?.id || null;
    payload.agenticShadowStatus = latestAgenticRun?.status || 'not_run';
    payload.agenticCriticScore = latestShadow?.critic_score_json || null;
    payload.executionMode = latestAgenticRun?.execution_mode || null;
    payload.agenticMode = latestAgenticRun?.execution_mode
      ? toLegacyExecutionMode(latestAgenticRun.execution_mode)
      : null;
  }

  return payload;
};

export const getCaseAnalysisTraceForOperator = async (
  caseIdParam: string,
  runId?: string
): Promise<unknown> => {
  const caseId = await resolveCaseId(caseIdParam);
  return getCaseRunTrace(caseId, runId);
};

export const submitCaseForPatient = async (
  caseId: string,
  userId: string,
  body: Record<string, unknown>
) => {
  await ensurePatientOwnsCase(caseId, userId);

  const caseRows = await caseRepository.findCaseSubmitValidation(caseId);
  if (caseRows.length === 0) {
    throw new AppError('Case not found', 404);
  }

  const row = caseRows[0] as {
    analysis_status: string;
    pdf_count: number;
    dicom_count: number;
  };

  if (row.pdf_count < 1 && row.dicom_count < 1) {
    throw new AppError('Upload at least one report before submission', 400);
  }

  const specialistQuestions = parseFlexibleSpecialistQuestions(body.specialistQuestions);
  const shareAiAnalysisWithSpecialists = parseShareAiAnalysisWithSpecialists(
    body.shareAiAnalysisWithSpecialists
  );

  if (row.analysis_status === 'queued' || row.analysis_status === 'processing') {
    throw new AppError(
      'AI analysis is still running. Wait for it to finish, or it will be attached automatically.',
      409
    );
  }

  await caseRepository.updateCaseOnSubmit(
    caseId,
    JSON.stringify(specialistQuestions),
    shareAiAnalysisWithSpecialists,
    DEFAULT_TURNAROUND_DAYS
  );
};

export const getCasesForPatient = async (userId: string, queryParams: Record<string, unknown>) => {
  const patientId = await getPatientIdForUser(userId);
  const { page, pageSize, offset } = parsePaginationQuery(queryParams);

  const rows = await caseRepository.findCasesForPatient(patientId, userId, pageSize, offset);
  const { rows: dataRows, total } = splitTotalCount(rows as Array<Record<string, unknown>>);

  return {
    data: dataRows,
    ...paginationMeta(page, pageSize, total),
  };
};

export const getCaseByIdForViewer = async (
  caseId: string,
  userId: string,
  userType: AuthUserType
) => {
  await ensureCaseAccess(caseId, userId, userType);

  const caseRows = await caseRepository.findCaseById(caseId);
  if (caseRows.length === 0) {
    throw new AppError('Case not found', 404);
  }

  const intakeRows = await caseRepository.findCaseIntake(caseId);
  const filesRows = await caseRepository.findMedicalFilesForCase(caseId);
  const assignedDoctors = await caseRepository.findAssignedDoctors(caseId);
  const imagingStudies = await getImagingStudiesForCase(caseId);
  const latestRun = await getLatestAnalysisRun(caseId);
  const symptomIntakeRow = await getLatestCaseSymptomIntake(caseId);

  const rawCaseRow = caseRows[0] as CaseRowWithAiSharing;
  const caseRow = sanitizeCaseRowForViewer(rawCaseRow, userType);

  const responseData: Record<string, unknown> = {
    ...caseRow,
    intake: intakeRows[0] || null,
    symptomIntake: symptomIntakeRow?.payload ?? null,
    files: filesRows,
    imagingStudies,
    assigned_doctors: assignedDoctors,
    analysis_attention_reason:
      userType === 'doctor' && rawCaseRow.share_ai_analysis_with_specialists === false
        ? null
        : latestRun?.attention_reason || null,
  };

  if (userType === 'doctor') {
    responseData.resolved_specialist_questions = resolveSpecialistQuestions(rawCaseRow);
  }

  // Parallel structured field for FE badges (flat string consumers keep cases.specialist_questions / analysisQuestions).
  responseData.specialist_questions_detailed = buildSpecialistQuestionsDetailed(rawCaseRow);
  if (Array.isArray(rawCaseRow.specialist_questions)) {
    responseData.specialist_questions = questionnaireItemsToStrings(
      parseFlexibleQuestionnaireItems(rawCaseRow.specialist_questions, { source: 'patient' })
    );
  }

  return responseData;
};

export const updateSpecialistQuestionsForPatient = async (
  caseIdParam: string,
  userId: string,
  body: Record<string, unknown>
) => {
  const caseId = await resolveCaseId(caseIdParam);
  await ensurePatientOwnsDraftCaseForQuestions(caseId, userId);

  const caseRows = await caseRepository.findCaseById(caseId);
  if (caseRows.length === 0) {
    throw new AppError('Case not found', 404);
  }

  const rawCaseRow = caseRows[0] as {
    specialist_questions?: unknown;
    analysis_questions?: string[] | null;
    analysis_artifact?: unknown;
    analysis_summary?: string | null;
    analysis_model?: string | null;
    share_ai_analysis_with_specialists?: boolean | null;
  };

  const prior = buildSpecialistQuestionsDetailed(rawCaseRow);
  const questions = parseAndValidateSpecialistQuestionsUpdate(body.questions, prior);

  await caseRepository.updateSpecialistQuestions(caseId, JSON.stringify(questions));

  return {
    specialist_questions: questionnaireItemsToStrings(questions),
    specialist_questions_detailed: questions,
  };
};

export const updateCaseForPatient = async (
  caseId: string,
  userId: string,
  body: Record<string, unknown>
) => {
  await ensurePatientOwnsCase(caseId, userId);

  const title = typeof body.title === 'string' ? body.title.trim() : null;
  const description = typeof body.description === 'string' ? body.description : null;

  await caseRepository.updateCaseTitleDescription(caseId, title, description);
};

export const deleteCaseForPatient = async (caseId: string, userId: string) => {
  await ensurePatientOwnsCase(caseId, userId);
  await clearDeidVaultsForCase(caseId);
  await caseRepository.deleteCase(caseId);
};

export const assignDoctorToCaseForPatient = async (
  caseId: string,
  userId: string,
  doctorId: unknown
) => {
  if (!doctorId || typeof doctorId !== 'string') {
    throw new AppError('doctorId is required', 400);
  }

  await ensurePatientOwnsCase(caseId, userId);
  await ensureDoctorCredentialVerifiedByDoctorId(doctorId);
  await caseRepository.insertCaseAssignment(caseId, doctorId);

  return { caseId, doctorId };
};

export const getDoctorCasesForUser = async (userId: string, queryParams: Record<string, unknown>) => {
  const doctorId = await getDoctorIdForUser(userId);
  const { page, pageSize, offset } = parsePaginationQuery(queryParams);

  const rows = await caseRepository.findDoctorCases(
    doctorId,
    DOCTOR_INBOX_CASE_STATUSES,
    DEFAULT_TURNAROUND_DAYS,
    pageSize,
    offset
  );

  const { rows: dataRows, total } = splitTotalCount(rows as Array<Record<string, unknown>>);

  return {
    data: dataRows.map((row) => mapDoctorInboxCaseRow(row as CaseRowWithAiSharing)),
    ...paginationMeta(page, pageSize, total),
  };
};

export const getDoctorDashboardStatsForUser = async (userId: string) => {
  const doctorId = await getDoctorIdForUser(userId);

  const rows = await caseRepository.findDoctorDashboardCaseRows(
    doctorId,
    DEFAULT_TURNAROUND_DAYS,
    DOCTOR_INBOX_CASE_STATUSES
  ) as Array<{ status: string; effective_due_date: string | Date | null }>;

  const pendingCases = rows.filter((row) => row.status !== 'completed').length;
  const responsesDueToday = rows.filter((row) => {
    if (row.status === 'completed') {
      return false;
    }
    const due = row.effective_due_date ? new Date(row.effective_due_date) : null;
    return isDueToday(due && !Number.isNaN(due.getTime()) ? due : null);
  }).length;

  return {
    pendingCases,
    responsesDueToday,
    totalCases: rows.length,
  };
};

export const removeDoctorCaseAssignmentForUser = async (caseId: string, userId: string) => {
  await ensureDoctorAssignedToCase(caseId, userId);
  const doctorId = await getDoctorIdForUser(userId);
  await caseRepository.deleteCaseAssignment(caseId, doctorId);
};

export const updateCaseStatusForDoctor = async (
  caseId: string,
  userId: string,
  status: unknown
) => {
  if (typeof status !== 'string' || !status.trim()) {
    throw new AppError('status is required', 400);
  }

  await ensureDoctorAssignedToCase(caseId, userId);
  const nextStatus = status.trim();
  await caseRepository.updateCaseStatus(caseId, nextStatus);
  if (nextStatus === 'completed') {
    await clearDeidVaultsForCase(caseId);
  }
};

export const generatePatientFacingAiDraft = async (
  caseId: string,
  userId: string,
  body: unknown
) => {
  await ensureDoctorAssignedToCase(caseId, userId);
  const payload = parsePatientFacingDraftRequest(body);
  return generatePatientFacingDraftForCase(caseId, userId, payload);
};

export const streamPatientFacingAiDraft = async (
  caseId: string,
  userId: string,
  body: unknown,
  options: { signal: AbortSignal }
) => {
  await ensureDoctorAssignedToCase(caseId, userId);
  const payload = parsePatientFacingDraftRequest(body);
  return streamPatientFacingDraftForCase(caseId, userId, payload, options);
};

export const previewDoctorOpinionForDoctor = async (
  caseId: string,
  userId: string,
  body: Record<string, unknown>
) => {
  await ensureDoctorAssignedToCase(caseId, userId);

  const caseRows = await caseRepository.findDoctorOpinionPreviewCase(caseId, userId);
  if (caseRows.length === 0) {
    throw new AppError('Case not found for assigned doctor', 404);
  }

  const row = caseRows[0] as DoctorOpinionCaseRow;

  let pdfInput: Parameters<typeof generateDoctorOpinionPdfBuffer>[0];

  if (isStructuredDoctorResponsePayload(body)) {
    const payload = parseDoctorResponseDraft(body);
    pdfInput = buildStructuredPdfInput(row, payload, { isDraft: true });
  } else {
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
      throw new AppError('content or structured doctor response is required', 400);
    }

    const { patientName, doctorName, patientAge } = buildDoctorOpinionNames(row);
    pdfInput = {
      caseTitle: row.title,
      caseNumber: row.case_number,
      patientName,
      patientFirstName: row.patient_first_name || null,
      doctorName,
      doctorSpecialty: row.doctor_specialty || '',
      doctorLicenseNumber: row.doctor_license_number || null,
      submittedDate: normalizeSubmittedDate(row.submitted_date),
      clinicalResponse: content,
      aiAssistedReview:
        row.share_ai_analysis_with_specialists !== false && row.analysis_status === 'succeeded',
      patientAge,
      patientSex: row.patient_sex || null,
      isDraft: true,
    };
  }

  const pdfBuffer = await generateDoctorOpinionPdfBuffer(pdfInput);
  const originalName = buildDoctorOpinionOriginalName(row.case_number);

  return { pdfBuffer, originalName };
};

export const sendDoctorOpinionForDoctor = async (
  caseId: string,
  userId: string,
  body: Record<string, unknown>
) => {
  await ensureDoctorAssignedToCase(caseId, userId);
  await ensureDoctorCredentialVerifiedByUserId(userId);

  const caseRows = await caseRepository.findDoctorOpinionSendCase(caseId, userId);
  if (caseRows.length === 0) {
    throw new AppError('Case not found for assigned doctor', 404);
  }

  const row = caseRows[0] as DoctorOpinionCaseRow & { patient_user_id: string; response_draft: unknown };
  const resolvedQuestions = resolveSpecialistQuestions(row);
  const signedAt = new Date().toISOString();

  let content: string;
  let nextStatus: string;
  let pdfInput: Parameters<typeof generateDoctorOpinionPdf>[0];
  let structuredPayload: ReturnType<typeof parseDoctorResponseSend> | null = null;

  if (isStructuredDoctorResponsePayload(body)) {
    const payload = parseDoctorResponseSend(body);
    structuredPayload = payload;
    validateDoctorResponseForSend(resolvedQuestions, payload);
    content = composeDoctorOpinionContent(payload);
    nextStatus =
      typeof payload.status === 'string' && payload.status.trim() ? payload.status.trim() : 'completed';
    pdfInput = buildStructuredPdfInput(row, payload, { isDraft: false, signedAt });
  } else {
    const legacyContent = typeof body.content === 'string' ? body.content : '';
    if (!legacyContent.trim()) {
      throw new AppError('content is required', 400);
    }

    content = legacyContent.trim();
    nextStatus =
      typeof body.status === 'string' && body.status.trim() ? body.status.trim() : 'completed';

    const { patientName, doctorName, patientAge } = buildDoctorOpinionNames(row);
    pdfInput = {
      caseTitle: row.title,
      caseNumber: row.case_number,
      patientName,
      patientFirstName: row.patient_first_name || null,
      doctorName,
      doctorSpecialty: row.doctor_specialty || '',
      doctorLicenseNumber: row.doctor_license_number || null,
      clinicalResponse: content,
      submittedDate: normalizeSubmittedDate(row.submitted_date),
      aiAssistedReview:
        row.share_ai_analysis_with_specialists !== false && row.analysis_status === 'succeeded',
      patientAge,
      patientSex: row.patient_sex || null,
      isDraft: false,
      signedAt,
    };
  }

  const pdfFile = await generateDoctorOpinionPdf(pdfInput);

  const attachments = [
    {
      filename: pdfFile.filename,
      originalName: pdfFile.originalName,
      size: pdfFile.size,
      mimetype: 'application/pdf',
    },
  ];

  const messageRow = await caseRepository.insertDoctorOpinionMessage({
    caseId,
    senderId: userId,
    receiverId: row.patient_user_id,
    content,
    attachmentsJson: JSON.stringify(attachments),
  });

  await caseRepository.updateCaseOnDoctorOpinionSend(caseId, nextStatus);
  await caseRepository.updateCaseAssignmentOnDoctorOpinionSend(caseId, userId);
  await clearDoctorResponseDraft(caseId, userId);
  if (nextStatus === 'completed') {
    await clearDeidVaultsForCase(caseId);
  }

  if (structuredPayload) {
    try {
      await recordAiDraftEditRatioOnSend({
        caseId,
        questionAnswers: structuredPayload.questionAnswers,
        aiDraftBaselines: structuredPayload.aiDraftBaselines,
        storedDraft: row.response_draft,
      });
    } catch (error) {
      logger.warn('Failed to record ai_draft_edit_ratio', {
        caseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    message: messageRow,
    attachment: attachments[0],
  };
};
