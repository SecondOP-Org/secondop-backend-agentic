import { Response, NextFunction } from 'express';
import { query, transaction } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest, AuthUserType } from '../middleware/auth';
import { isCommandCenterOperator } from '../middleware/commandCenterAuth';
import { extractObservationsFromSummary } from '../services/analysis.service';
import {
  artifactQuestionsToStrings,
  extractObservationsFromArtifact,
  hydrateCaseAnalysisArtifact,
} from '../services/analysisArtifact.service';
import { toLegacyExecutionMode } from '../agentic/core/executionMode';
import { getLatestAnalysisRun, getLatestAnalysisRunByEngine, getLatestShadowResultByCaseId } from '../services/analysisRun.service';
import { iterateAnalysisProgress } from '../services/analysisProgress.service';
import { getCaseRunTrace } from '../agentic/observability/analysisObservability.service';
import { analysisWorker } from '../services/analysisWorker.service';
import { getImagingStudiesForCase } from '../services/dicomImaging.service';
import {
  buildDoctorOpinionOriginalName,
  generateDoctorOpinionPdf,
  generateDoctorOpinionPdfBuffer,
} from '../services/doctorOpinionPdf.service';
import {
  appendDoctorKeyImage,
  clearDoctorResponseDraft,
  composeDoctorOpinionContent,
  getDoctorResponse,
  resolveKeyImagesForPdf,
  resolveSpecialistQuestions,
  saveDoctorResponseDraft,
  validateDoctorResponseForSend,
} from '../services/doctorResponse.service';
import { recordAiDraftEditRatioOnSend } from '../services/doctorEditDistance.service';
import { startCaseReview } from '../services/doctorCaseWorkflow.service';
import {
  ensureDoctorCredentialVerifiedByDoctorId,
  ensureDoctorCredentialVerifiedByUserId,
} from '../services/doctorVerification.service';
import {
  isStructuredDoctorResponsePayload,
  parseDoctorResponseDraft,
  parseDoctorResponseSend,
} from '../schemas/doctorResponse.schema';
import { parsePatientFacingDraftRequest } from '../schemas/patientFacingDraft.schema';
import { generatePatientFacingDraftForCase } from '../services/patientFacingDraft.service';
import { generateCaseNumber } from '../utils/caseNumber';
import { resolveCaseId } from '../utils/caseIdentifier';
import {
  paginationMeta,
  parsePaginationQuery,
  splitTotalCount,
} from '../utils/pagination';
import {
  DOCTOR_INBOX_CASE_STATUSES,
  DEFAULT_TURNAROUND_DAYS,
  isDueToday,
  isOverdue,
  resolveEffectiveDueDate,
} from '../services/doctorCaseInbox.service';
import logger from '../utils/logger';

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

const assertNonEmptyString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${fieldName} is required`, 400);
  }

  return value.trim();
};

const parseIntake = (input: unknown): IntakePayload => {
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
    symptoms: assertNonEmptyString((input as { symptoms?: unknown }).symptoms, 'intake.symptoms'),
    symptomDuration: assertNonEmptyString(
      (input as { symptomDuration?: unknown }).symptomDuration,
      'intake.symptomDuration'
    ),
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
  const patientResult = await query('SELECT id FROM patients WHERE user_id = $1', [userId]);

  if (patientResult.rows.length === 0) {
    throw new AppError('Patient profile not found', 404);
  }

  return patientResult.rows[0].id as string;
};

const ensurePatientOwnsCase = async (caseId: string, userId: string): Promise<void> => {
  const result = await query(
    `SELECT c.id
     FROM cases c
     JOIN patients p ON p.id = c.patient_id
     WHERE c.id = $1 AND p.user_id = $2`,
    [caseId, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('You do not have access to this case', 403);
  }
};

const ensureDoctorAssignedToCase = async (caseId: string, userId: string): Promise<void> => {
  const result = await query(
    `SELECT c.id
     FROM cases c
     JOIN case_assignments ca ON ca.case_id = c.id
     JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1 AND d.user_id = $2`,
    [caseId, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('You do not have access to this case', 403);
  }
};

const ensureCaseAccess = async (
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

// Patient-supplied specialist questions are always optional now.
// Accept 0–3 questions; trim, drop empties, cap at 3. Never throw on count.
// (Exactly-3 validation for AI-generated questions lives in analysis services / eval harness.)
const parseFlexibleSpecialistQuestions = (input: unknown): string[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 3);
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

type CaseRowWithAiSharing = Record<string, unknown> & {
  share_ai_analysis_with_specialists?: boolean | null;
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

const sanitizeCaseRowForViewer = <T extends CaseRowWithAiSharing>(
  row: T,
  userType: AuthUserType
): T => {
  if (userType === 'doctor' && row.share_ai_analysis_with_specialists === false) {
    return redactAiAnalysisForDoctor(row);
  }

  return row;
};

const fetchAssignedDoctors = async (caseId: string) => {
  const assignments = await query(
    `SELECT ca.id,
            ca.status,
            ca.assigned_date,
            d.id AS doctor_id,
            d.user_id,
            d.first_name,
            d.last_name,
            d.specialty,
            d.rating,
            d.review_count,
            d.country,
            d.city,
            d.consultation_fee,
            u.email
     FROM case_assignments ca
     JOIN doctors d ON d.id = ca.doctor_id
     JOIN users u ON u.id = d.user_id
     WHERE ca.case_id = $1
     ORDER BY ca.assigned_date ASC`,
    [caseId]
  );

  return assignments.rows;
};

export const createCase = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const patientId = await getPatientIdForUser(userId);

    const title = assertNonEmptyString(req.body.title, 'title');
    const description = typeof req.body.description === 'string' ? req.body.description : '';
    const specialty = assertNonEmptyString(req.body.specialty, 'specialty');
    const priority = typeof req.body.priority === 'string' ? req.body.priority : 'medium';
    const urgencyLevel = typeof req.body.urgencyLevel === 'string' ? req.body.urgencyLevel : 'moderate';
    const status = req.body.status === 'draft' ? 'draft' : 'pending';
    const intake = parseIntake(req.body.intake);

    const caseNumber = generateCaseNumber();

    const created = await transaction(async (client) => {
      const caseInsert = await client.query(
        `INSERT INTO cases (case_number, patient_id, title, description, specialty, priority, urgency_level, status, analysis_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'not_started')
         RETURNING *`,
        [caseNumber, patientId, title, description, specialty, priority, urgencyLevel, status]
      );

      const caseRow = caseInsert.rows[0];

      await client.query(
        `INSERT INTO case_intake (case_id, age_at_submission, sex, specialty_context, symptoms, symptom_duration, medical_history, current_medications, allergies)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          caseRow.id,
          intake.age,
          intake.sex,
          intake.specialtyContext,
          intake.symptoms,
          intake.symptomDuration,
          intake.medicalHistory,
          intake.currentMedications,
          intake.allergies,
        ]
      );

      return caseRow;
    });

    res.status(201).json({
      status: 'success',
      data: created,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCaseIntake = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensurePatientOwnsCase(caseId, userId);
    const intake = parseIntake(req.body.intake);

    await query(
      `INSERT INTO case_intake (case_id, age_at_submission, sex, specialty_context, symptoms, symptom_duration, medical_history, current_medications, allergies)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (case_id)
       DO UPDATE SET
         age_at_submission = EXCLUDED.age_at_submission,
         sex = EXCLUDED.sex,
         specialty_context = EXCLUDED.specialty_context,
         symptoms = EXCLUDED.symptoms,
         symptom_duration = EXCLUDED.symptom_duration,
         medical_history = EXCLUDED.medical_history,
         current_medications = EXCLUDED.current_medications,
         allergies = EXCLUDED.allergies,
         updated_at = CURRENT_TIMESTAMP`,
      [
        caseId,
        intake.age,
        intake.sex,
        intake.specialtyContext,
        intake.symptoms,
        intake.symptomDuration,
        intake.medicalHistory,
        intake.currentMedications,
        intake.allergies,
      ]
    );

    if (typeof req.body.specialty === 'string' && req.body.specialty.trim()) {
      await query(
        `UPDATE cases
         SET specialty = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [req.body.specialty.trim(), caseId]
      );
    }

    res.json({
      status: 'success',
      message: 'Case intake updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const queueCaseAnalysis = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensurePatientOwnsCase(caseId, userId);

    const intakeResult = await query('SELECT case_id FROM case_intake WHERE case_id = $1', [caseId]);
    if (intakeResult.rows.length === 0) {
      throw new AppError('Case intake is required before analysis', 400);
    }

    const filesResult = await query(
      `SELECT COUNT(*)::int as file_count
       FROM medical_files
       WHERE case_id = $1
         AND (
           file_type = 'application/pdf'
           OR LOWER(file_name) LIKE '%.pdf'
           OR file_type LIKE 'image/%'
           OR LOWER(file_name) ~ '\\.(jpe?g|png|gif|webp)$'
         )`,
      [caseId]
    );

    const fileCount = filesResult.rows[0].file_count as number;
    if (fileCount < 1) {
      throw new AppError('At least one medical report (PDF or image) is required before analysis', 400);
    }

    const queued = await analysisWorker.queueCase(caseId);

    res.json({
      status: 'success',
      data: {
        caseId,
        analysisStatus: queued.analysisStatus,
        analysisRunId: queued.analysisRunId,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getCaseAnalysis = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const caseId = await resolveCaseId(req.params.caseId);
    const userId = req.user!.id;
    const userType = req.user!.type;
    const includeAgentic = String(req.query.includeAgentic || "").toLowerCase() === "true";

    await ensureCaseAccess(caseId, userId, userType);

    const result = await query(
      `SELECT analysis_status,
              analysis_summary,
              analysis_questions,
              analysis_artifact,
              analysis_model,
              analysis_error,
              share_ai_analysis_with_specialists
       FROM cases
       WHERE id = $1`,
      [caseId]
    );

    if (result.rows.length === 0) {
      throw new AppError("Case not found", 404);
    }

    const row = result.rows[0] as {
      analysis_status: string;
      analysis_summary: string | null;
      analysis_questions: string[] | null;
      analysis_artifact: unknown;
      analysis_model: string | null;
      analysis_error: string | null;
      share_ai_analysis_with_specialists: boolean;
    };

    if (userType === 'doctor' && row.share_ai_analysis_with_specialists === false) {
      res.json({
        status: 'success',
        data: {
          analysisStatus: 'not_started',
          summary: null,
          analysisQuestions: null,
          artifact: null,
          error: null,
          analysisRunId: null,
          attentionReason: null,
          analysisRetrying: false,
          observations: null,
          aiAnalysisSharedWithSpecialists: false,
        },
      });
      return;
    }

    const latestRun = await getLatestAnalysisRun(caseId);
    const analysisRetrying =
      row.analysis_status === 'processing' &&
      ((latestRun?.attempt_count ?? 1) > 1 ||
        (typeof row.analysis_error === 'string' &&
          row.analysis_error.toLowerCase().startsWith('retrying analysis')));

    const artifact = hydrateCaseAnalysisArtifact({
      artifact: row.analysis_artifact,
      summary: row.analysis_summary,
      questions: row.analysis_questions,
      model: row.analysis_model,
    });
    const observations =
      artifact
        ? extractObservationsFromArtifact(artifact)
        : typeof row.analysis_summary === "string" && row.analysis_summary.trim()
          ? extractObservationsFromSummary(row.analysis_summary)
          : null;

    const payload: Record<string, unknown> = {
      analysisStatus: row.analysis_status,
      summary: artifact ? artifact.structured_summary.chief_concern || row.analysis_summary : row.analysis_summary,
      analysisQuestions: artifact ? artifactQuestionsToStrings(artifact) : row.analysis_questions,
      artifact,
      // Hide raw retry diagnostics from patients; terminal errors stay for ops/debug but FE maps them.
      error: analysisRetrying ? null : row.analysis_error,
      analysisRunId: latestRun?.id || null,
      attentionReason: latestRun?.attention_reason || null,
      analysisRetrying,
      observations,
    };

    if (includeAgentic) {
      if (!isCommandCenterOperator(req.user)) {
        throw new AppError('Insufficient command-center permissions', 403);
      }

      const latestAgenticRun = await getLatestAnalysisRunByEngine(caseId, "agentic");
      const latestShadow = await getLatestShadowResultByCaseId(caseId);

      payload.agenticRunId = latestAgenticRun?.id || null;
      payload.agenticShadowStatus = latestAgenticRun?.status || "not_run";
      payload.agenticCriticScore = latestShadow?.critic_score_json || null;
      payload.executionMode = latestAgenticRun?.execution_mode || null;
      payload.agenticMode = latestAgenticRun?.execution_mode
        ? toLegacyExecutionMode(latestAgenticRun.execution_mode)
        : null;
    }

    res.json({
      status: "success",
      data: payload,
    });
  } catch (error) {
    next(error);
  }
};

export const streamCaseAnalysisProgress = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const caseId = await resolveCaseId(req.params.caseId);
    const userId = req.user!.id;
    const userType = req.user!.type;
    const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;

    await ensureCaseAccess(caseId, userId, userType);

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
      (res as Response & { flushHeaders: () => void }).flushHeaders();
    }

    let clientClosed = false;
    req.on('close', () => {
      clientClosed = true;
    });

    for await (const event of iterateAnalysisProgress({ caseId, runId })) {
      if (clientClosed) {
        break;
      }
      res.write(`${JSON.stringify(event)}\n`);
    }

    res.end();
  } catch (error) {
    if (!res.headersSent) {
      next(error);
      return;
    }
    res.end();
  }
};

export const getCaseAnalysisTrace = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Operator-only via authorizeCommandCenterOperator on the route (SEC-110).
    // Do not require case ownership — ops must inspect any case by id.
    const caseId = await resolveCaseId(req.params.caseId);
    const runId = typeof req.query.runId === "string" ? req.query.runId : undefined;

    const trace = await getCaseRunTrace(caseId, runId);

    res.json({
      status: "success",
      data: trace,
    });
  } catch (error) {
    next(error);
  }
};

export const submitCase = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensurePatientOwnsCase(caseId, userId);

    const caseResult = await query(
      `SELECT c.analysis_status,
              COUNT(*) FILTER (
                WHERE mf.file_type = 'application/pdf' OR LOWER(mf.file_name) LIKE '%.pdf'
              )::int AS pdf_count,
              COUNT(*) FILTER (
                WHERE mf.is_dicom = true
                   OR LOWER(mf.file_name) LIKE '%.dcm'
                   OR LOWER(mf.file_name) LIKE '%.dicom'
              )::int AS dicom_count
       FROM cases c
       LEFT JOIN medical_files mf ON mf.case_id = c.id
       WHERE c.id = $1
       GROUP BY c.id, c.analysis_status`,
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      throw new AppError('Case not found', 404);
    }

    const row = caseResult.rows[0] as {
      analysis_status: string;
      pdf_count: number;
      dicom_count: number;
    };

    if (row.pdf_count < 1 && row.dicom_count < 1) {
      throw new AppError('Upload at least one report before submission', 400);
    }

    const specialistQuestions = parseFlexibleSpecialistQuestions(req.body.specialistQuestions);
    const shareAiAnalysisWithSpecialists = parseShareAiAnalysisWithSpecialists(
      req.body.shareAiAnalysisWithSpecialists
    );

    if (row.analysis_status === 'queued' || row.analysis_status === 'processing') {
      throw new AppError(
        'AI analysis is still running. Wait for it to finish, or it will be attached automatically.',
        409
      );
    }

    await query(
      `UPDATE cases
       SET specialist_questions = $2,
           share_ai_analysis_with_specialists = $3,
           status = 'pending',
           submitted_date = COALESCE(submitted_date, CURRENT_TIMESTAMP),
           due_date = COALESCE(due_date, CURRENT_TIMESTAMP + ($4::int * INTERVAL '1 day')),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [caseId, JSON.stringify(specialistQuestions), shareAiAnalysisWithSpecialists, DEFAULT_TURNAROUND_DAYS]
    );

    res.json({
      status: 'success',
      message: 'Case submitted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getCases = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const patientId = await getPatientIdForUser(userId);
    const { page, pageSize, offset } = parsePaginationQuery(req.query);

    const result = await query(
      `SELECT c.*,
              ci.age_at_submission,
              ci.sex,
              ci.specialty_context,
              COALESCE(assigned_doctors.assigned_doctors, '[]'::json) AS assigned_doctors,
              latest_message.latest_message_preview,
              latest_message.latest_message_created_at,
              latest_message.latest_message_sender_name,
              COALESCE(latest_message.has_unread_messages, false) AS has_unread_messages,
              COUNT(*) OVER() AS __total_count
       FROM cases c
       LEFT JOIN case_intake ci ON ci.case_id = c.id
       LEFT JOIN LATERAL (
         SELECT json_agg(
                  json_build_object(
                    'doctorId', d.id,
                    'userId', d.user_id,
                    'name', CONCAT(d.first_name, ' ', d.last_name),
                    'specialty', d.specialty,
                    'status', ca.status
                  )
                  ORDER BY ca.assigned_date ASC
                ) AS assigned_doctors
         FROM case_assignments ca
         JOIN doctors d ON d.id = ca.doctor_id
         WHERE ca.case_id = c.id
       ) assigned_doctors ON true
       LEFT JOIN LATERAL (
         SELECT m.content AS latest_message_preview,
                m.created_at AS latest_message_created_at,
                COALESCE(dp.first_name || ' ' || dp.last_name, dd.first_name || ' ' || dd.last_name, us.email) AS latest_message_sender_name,
                EXISTS(
                  SELECT 1
                  FROM messages unread
                  WHERE unread.case_id = c.id
                    AND unread.receiver_id = $2
                    AND unread.is_read = false
                ) AS has_unread_messages
         FROM messages m
         JOIN users us ON us.id = m.sender_id
         LEFT JOIN patients dp ON dp.user_id = m.sender_id
         LEFT JOIN doctors dd ON dd.user_id = m.sender_id
         WHERE m.case_id = c.id
         ORDER BY m.created_at DESC
         LIMIT 1
       ) latest_message ON true
       WHERE c.patient_id = $1
       ORDER BY c.submitted_date DESC
       LIMIT $3 OFFSET $4`,
      [patientId, userId, pageSize, offset]
    );

    const { rows, total } = splitTotalCount(result.rows as Array<Record<string, unknown>>);

    res.json({
      status: 'success',
      data: rows,
      ...paginationMeta(page, pageSize, total),
    });
  } catch (error) {
    next(error);
  }
};

export const getCaseById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;
    const userType = req.user!.type;

    await ensureCaseAccess(caseId, userId, userType);

    const caseResult = await query(
      `SELECT c.*,
              p.first_name AS patient_first_name,
              p.last_name AS patient_last_name,
              p.user_id AS patient_user_id,
              p.gender AS patient_gender,
              p.country AS patient_country,
              p.city AS patient_city,
              u.email AS patient_email,
              u.phone AS patient_phone
       FROM cases c
       JOIN patients p ON p.id = c.patient_id
       JOIN users u ON u.id = p.user_id
       WHERE c.id = $1`,
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      throw new AppError('Case not found', 404);
    }

    const intakeResult = await query(
      `SELECT age_at_submission, sex, specialty_context, symptoms, symptom_duration, medical_history, current_medications, allergies
       FROM case_intake
       WHERE case_id = $1`,
      [caseId]
    );

    const filesResult = await query(
      `SELECT mf.id,
              mf.file_name,
              mf.file_type,
              mf.file_size,
              mf.file_url,
              mf.file_category,
              mf.description,
              mf.is_dicom,
              di.dicom_extraction_status,
              di.dicom_extraction_error,
              mf.created_at
       FROM medical_files mf
       LEFT JOIN dicom_instances di ON di.file_id = mf.id
       WHERE mf.case_id = $1
       ORDER BY mf.created_at DESC`,
      [caseId]
    );
    const assignedDoctors = await fetchAssignedDoctors(caseId);
    const imagingStudies = await getImagingStudiesForCase(caseId);
    const latestRun = await getLatestAnalysisRun(caseId);

    const caseRow = sanitizeCaseRowForViewer(
      caseResult.rows[0] as CaseRowWithAiSharing,
      userType
    );

    const responseData: Record<string, unknown> = {
      ...caseRow,
      intake: intakeResult.rows[0] || null,
      files: filesResult.rows,
      imagingStudies,
      assigned_doctors: assignedDoctors,
      analysis_attention_reason:
        userType === 'doctor' &&
        (caseResult.rows[0] as CaseRowWithAiSharing).share_ai_analysis_with_specialists === false
          ? null
          : latestRun?.attention_reason || null,
    };

    if (userType === 'doctor') {
      responseData.resolved_specialist_questions = resolveSpecialistQuestions(
        caseResult.rows[0] as CaseRowWithAiSharing
      );
    }

    res.json({
      status: 'success',
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCase = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensurePatientOwnsCase(caseId, userId);

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : null;
    const description = typeof req.body.description === 'string' ? req.body.description : null;

    await query(
      `UPDATE cases
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [title, description, caseId]
    );

    res.json({
      status: 'success',
      message: 'Case updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCase = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensurePatientOwnsCase(caseId, userId);
    await query('DELETE FROM cases WHERE id = $1', [caseId]);

    res.json({
      status: 'success',
      message: 'Case deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const assignDoctorToCase = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const { doctorId } = req.body;
    const userId = req.user!.id;

    if (!doctorId || typeof doctorId !== 'string') {
      throw new AppError('doctorId is required', 400);
    }

    await ensurePatientOwnsCase(caseId, userId);
    await ensureDoctorCredentialVerifiedByDoctorId(doctorId);

    await query(
      `INSERT INTO case_assignments (case_id, doctor_id, status)
       VALUES ($1, $2, 'assigned')
       ON CONFLICT (case_id, doctor_id)
       DO NOTHING`,
      [caseId, doctorId]
    );

    res.json({
      status: 'success',
      data: {
        caseId,
        doctorId,
      },
      message: 'Doctor assigned to case successfully',
    });
  } catch (error) {
    next(error);
  }
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

export const getDoctorCases = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { page, pageSize, offset } = parsePaginationQuery(req.query);

    const doctorResult = await query('SELECT id FROM doctors WHERE user_id = $1', [userId]);
    if (doctorResult.rows.length === 0) {
      throw new AppError('Doctor profile not found', 404);
    }

    const doctorId = doctorResult.rows[0].id as string;

    const result = await query(
      `SELECT c.*, ca.status as assignment_status, ca.assigned_date,
              ci.age_at_submission,
              ci.sex,
              ci.specialty_context,
              ci.symptoms,
              ci.symptom_duration,
              ci.medical_history,
              ci.current_medications,
              ci.allergies,
              p.first_name as patient_first_name,
              p.last_name as patient_last_name,
              COUNT(*) OVER() AS __total_count
       FROM cases c
       JOIN case_assignments ca ON c.id = ca.case_id
       JOIN patients p ON p.id = c.patient_id
       LEFT JOIN case_intake ci ON ci.case_id = c.id
       WHERE ca.doctor_id = $1
         AND c.status <> 'draft'
         AND c.status = ANY($2::text[])
       ORDER BY COALESCE(c.due_date, c.submitted_date + ($3::int * INTERVAL '1 day')) ASC NULLS LAST,
                ca.assigned_date DESC
       LIMIT $4 OFFSET $5`,
      [doctorId, DOCTOR_INBOX_CASE_STATUSES, DEFAULT_TURNAROUND_DAYS, pageSize, offset]
    );

    const { rows, total } = splitTotalCount(result.rows as Array<Record<string, unknown>>);

    res.json({
      status: 'success',
      data: rows.map((row) => mapDoctorInboxCaseRow(row as CaseRowWithAiSharing)),
      ...paginationMeta(page, pageSize, total),
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorDashboardStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    const doctorResult = await query('SELECT id FROM doctors WHERE user_id = $1', [userId]);
    if (doctorResult.rows.length === 0) {
      throw new AppError('Doctor profile not found', 404);
    }

    const doctorId = doctorResult.rows[0].id as string;

    const result = await query(
      `SELECT c.status,
              COALESCE(c.due_date, c.submitted_date + ($2::int * INTERVAL '1 day')) AS effective_due_date
       FROM cases c
       JOIN case_assignments ca ON c.id = ca.case_id
       WHERE ca.doctor_id = $1
         AND c.status <> 'draft'
         AND c.status = ANY($3::text[])`,
      [doctorId, DEFAULT_TURNAROUND_DAYS, DOCTOR_INBOX_CASE_STATUSES]
    );

    const rows = result.rows as Array<{ status: string; effective_due_date: string | Date | null }>;
    const pendingCases = rows.filter((row) => row.status === 'pending').length;
    const responsesDueToday = rows.filter((row) => {
      if (row.status === 'completed') {
        return false;
      }
      const due = row.effective_due_date ? new Date(row.effective_due_date) : null;
      return isDueToday(due && !Number.isNaN(due.getTime()) ? due : null);
    }).length;

    res.json({
      status: 'success',
      data: {
        pendingCases,
        responsesDueToday,
        totalCases: rows.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const removeDoctorCaseAssignment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensureDoctorAssignedToCase(caseId, userId);

    const doctorResult = await query('SELECT id FROM doctors WHERE user_id = $1', [userId]);
    const doctorId = doctorResult.rows[0].id as string;

    await query(
      `DELETE FROM case_assignments
       WHERE case_id = $1
         AND doctor_id = $2`,
      [caseId, doctorId]
    );

    res.json({
      status: 'success',
      message: 'Case removed from your queue',
    });
  } catch (error) {
    next(error);
  }
};

export const updateCaseStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const { status } = req.body;
    const userId = req.user!.id;

    if (typeof status !== 'string' || !status.trim()) {
      throw new AppError('status is required', 400);
    }

    await ensureDoctorAssignedToCase(caseId, userId);

    await query(
      `UPDATE cases
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [status.trim(), caseId]
    );

    res.json({
      status: 'success',
      message: 'Case status updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const startCaseReviewHandler = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    const result = await startCaseReview(caseId, userId);

    res.json({
      status: 'success',
      data: result,
      message: 'Case review started',
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorResponseDraft = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensureDoctorAssignedToCase(caseId, userId);

    const data = await getDoctorResponse(caseId, userId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const saveDoctorResponseDraftHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensureDoctorAssignedToCase(caseId, userId);

    const draft = await saveDoctorResponseDraft(caseId, userId, req.body);

    res.json({
      status: 'success',
      data: { draft },
      message: 'Doctor response draft saved',
    });
  } catch (error) {
    next(error);
  }
};

export const generatePatientFacingAiDraftHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensureDoctorAssignedToCase(caseId, userId);

    const payload = parsePatientFacingDraftRequest(req.body);
    const result = await generatePatientFacingDraftForCase(caseId, userId, payload);

    res.json({
      status: 'success',
      data: result,
      message: 'Patient-facing AI draft generated',
    });
  } catch (error) {
    next(error);
  }
};

export const uploadDoctorKeyImageHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;
    const file = req.file;

    await ensureDoctorAssignedToCase(caseId, userId);

    if (!file) {
      throw new AppError('Key image file is required', 400);
    }

    const seriesUid = typeof req.body.seriesUid === 'string' ? req.body.seriesUid.trim() : '';
    if (!seriesUid) {
      throw new AppError('seriesUid is required', 400);
    }

    const parseOptionalNumber = (value: unknown): number | null => {
      if (value === undefined || value === null || value === '') {
        return null;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const result = await appendDoctorKeyImage(caseId, userId, {
      filename: file.filename,
      mimeType: file.mimetype || 'image/png',
      seriesUid,
      seriesDescription:
        typeof req.body.seriesDescription === 'string' ? req.body.seriesDescription : null,
      instanceNumber: parseOptionalNumber(req.body.instanceNumber),
      sopInstanceUid:
        typeof req.body.sopInstanceUid === 'string' ? req.body.sopInstanceUid : null,
      sourceFileId: typeof req.body.sourceFileId === 'string' ? req.body.sourceFileId : null,
      caption: typeof req.body.caption === 'string' ? req.body.caption : undefined,
    });

    res.status(201).json({
      status: 'success',
      data: result,
      message: 'Key image added to doctor response draft',
    });
  } catch (error) {
    next(error);
  }
};

export const previewDoctorOpinion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensureDoctorAssignedToCase(caseId, userId);

    const caseResult = await query(
      `SELECT c.id, c.title, c.case_number, c.submitted_date,
              c.specialist_questions,
              c.analysis_questions,
              c.analysis_artifact,
              c.analysis_summary,
              c.analysis_model,
              c.share_ai_analysis_with_specialists,
              c.analysis_status,
              p.first_name as patient_first_name,
              p.last_name as patient_last_name,
              d.first_name as doctor_first_name,
              d.last_name as doctor_last_name,
              d.specialty as doctor_specialty,
              d.license_number as doctor_license_number,
              ci.age_at_submission as patient_age,
              ci.sex as patient_sex
       FROM cases c
       JOIN patients p ON p.id = c.patient_id
       JOIN case_assignments ca ON ca.case_id = c.id
       JOIN doctors d ON d.id = ca.doctor_id
       LEFT JOIN case_intake ci ON ci.case_id = c.id
       WHERE c.id = $1 AND d.user_id = $2
       LIMIT 1`,
      [caseId, userId]
    );

    if (caseResult.rows.length === 0) {
      throw new AppError('Case not found for assigned doctor', 404);
    }

    const row = caseResult.rows[0];
    const patientName = `${row.patient_first_name || ''} ${row.patient_last_name || ''}`.trim() || 'Patient';
    const doctorName = `${row.doctor_first_name || ''} ${row.doctor_last_name || ''}`.trim() || 'Specialist';
    const patientAge =
      row.patient_age == null || Number.isNaN(Number(row.patient_age))
        ? null
        : Number(row.patient_age);

    let pdfInput: Parameters<typeof generateDoctorOpinionPdfBuffer>[0];

    if (isStructuredDoctorResponsePayload(req.body)) {
      const payload = parseDoctorResponseDraft(req.body);
      const recommendations =
        (payload.recommendations || '').trim() || (payload.summary || '').trim();

      pdfInput = {
        caseTitle: row.title,
        caseNumber: row.case_number,
        patientName,
        patientFirstName: row.patient_first_name || null,
        doctorName,
        doctorSpecialty: row.doctor_specialty || '',
        doctorLicenseNumber: row.doctor_license_number || null,
        submittedDate: row.submitted_date,
        questionAnswers: payload.questionAnswers,
        summary: payload.summary,
        recommendations,
        clinicalSummary: payload.clinicalSummary,
        assessment: payload.assessment,
        concordance: payload.concordance ?? null,
        limitations: payload.limitations,
        recordsReviewed: payload.recordsReviewed || [],
        keyImages: resolveKeyImagesForPdf(payload.keyImages),
        aiAssistedReview: row.share_ai_analysis_with_specialists !== false && row.analysis_status === 'succeeded',
        patientAge,
        patientSex: row.patient_sex || null,
        isDraft: true,
      };
    } else {
      const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
      if (!content) {
        throw new AppError('content or structured doctor response is required', 400);
      }

      pdfInput = {
        caseTitle: row.title,
        caseNumber: row.case_number,
        patientName,
        patientFirstName: row.patient_first_name || null,
        doctorName,
        doctorSpecialty: row.doctor_specialty || '',
        doctorLicenseNumber: row.doctor_license_number || null,
        submittedDate: row.submitted_date,
        clinicalResponse: content,
        aiAssistedReview: row.share_ai_analysis_with_specialists !== false && row.analysis_status === 'succeeded',
        patientAge,
        patientSex: row.patient_sex || null,
        isDraft: true,
      };
    }

    const pdfBuffer = await generateDoctorOpinionPdfBuffer(pdfInput);
    const originalName = buildDoctorOpinionOriginalName(row.case_number);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${originalName}"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

export const sendDoctorOpinion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;

    await ensureDoctorAssignedToCase(caseId, userId);
    await ensureDoctorCredentialVerifiedByUserId(userId);

    const caseResult = await query(
      `SELECT c.id, c.title, c.case_number, c.submitted_date,
              c.specialist_questions,
              c.analysis_questions,
              c.analysis_artifact,
              c.analysis_summary,
              c.analysis_model,
              c.share_ai_analysis_with_specialists,
              c.analysis_status,
              ca.response_draft,
              p.user_id as patient_user_id,
              p.first_name as patient_first_name,
              p.last_name as patient_last_name,
              d.first_name as doctor_first_name,
              d.last_name as doctor_last_name,
              d.specialty as doctor_specialty,
              d.license_number as doctor_license_number,
              ci.age_at_submission as patient_age,
              ci.sex as patient_sex
       FROM cases c
       JOIN patients p ON p.id = c.patient_id
       JOIN case_assignments ca ON ca.case_id = c.id
       JOIN doctors d ON d.id = ca.doctor_id
       LEFT JOIN case_intake ci ON ci.case_id = c.id
       WHERE c.id = $1 AND d.user_id = $2
       LIMIT 1`,
      [caseId, userId]
    );

    if (caseResult.rows.length === 0) {
      throw new AppError('Case not found for assigned doctor', 404);
    }

    const row = caseResult.rows[0];
    const resolvedQuestions = resolveSpecialistQuestions(row);
    const patientName = `${row.patient_first_name || ''} ${row.patient_last_name || ''}`.trim() || 'Patient';
    const doctorName = `${row.doctor_first_name || ''} ${row.doctor_last_name || ''}`.trim() || 'Specialist';
    const patientAge =
      row.patient_age == null || Number.isNaN(Number(row.patient_age))
        ? null
        : Number(row.patient_age);
    const signedAt = new Date().toISOString();

    let content: string;
    let nextStatus: string;
    let pdfInput: Parameters<typeof generateDoctorOpinionPdf>[0];
    let structuredPayload: ReturnType<typeof parseDoctorResponseSend> | null = null;

    if (isStructuredDoctorResponsePayload(req.body)) {
      const payload = parseDoctorResponseSend(req.body);
      structuredPayload = payload;
      validateDoctorResponseForSend(resolvedQuestions, payload);
      content = composeDoctorOpinionContent(payload);
      nextStatus = typeof payload.status === 'string' && payload.status.trim() ? payload.status.trim() : 'completed';

      const recommendations =
        (payload.recommendations || '').trim() || (payload.summary || '').trim();

      pdfInput = {
        caseTitle: row.title,
        caseNumber: row.case_number,
        patientName,
        patientFirstName: row.patient_first_name || null,
        doctorName,
        doctorSpecialty: row.doctor_specialty || '',
        doctorLicenseNumber: row.doctor_license_number || null,
        submittedDate: row.submitted_date,
        questionAnswers: payload.questionAnswers,
        summary: payload.summary,
        recommendations,
        clinicalSummary: payload.clinicalSummary,
        assessment: payload.assessment,
        concordance: payload.concordance ?? null,
        limitations: payload.limitations,
        recordsReviewed: payload.recordsReviewed || [],
        keyImages: resolveKeyImagesForPdf(payload.keyImages),
        aiAssistedReview: row.share_ai_analysis_with_specialists !== false && row.analysis_status === 'succeeded',
        patientAge,
        patientSex: row.patient_sex || null,
        isDraft: false,
        signedAt,
      };
    } else {
      const legacyContent = typeof req.body.content === 'string' ? req.body.content : '';
      if (!legacyContent.trim()) {
        throw new AppError('content is required', 400);
      }

      content = legacyContent.trim();
      nextStatus =
        typeof req.body.status === 'string' && req.body.status.trim() ? req.body.status.trim() : 'completed';

      pdfInput = {
        caseTitle: row.title,
        caseNumber: row.case_number,
        patientName,
        patientFirstName: row.patient_first_name || null,
        doctorName,
        doctorSpecialty: row.doctor_specialty || '',
        doctorLicenseNumber: row.doctor_license_number || null,
        clinicalResponse: content,
        submittedDate: row.submitted_date,
        aiAssistedReview: row.share_ai_analysis_with_specialists !== false && row.analysis_status === 'succeeded',
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

    const messageResult = await query(
      `INSERT INTO messages (case_id, sender_id, receiver_id, content, message_type, attachments)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        caseId,
        userId,
        row.patient_user_id,
        content,
        'doctor_opinion',
        JSON.stringify(attachments),
      ]
    );

    await query(
      `UPDATE cases
       SET status = $1,
           completed_date = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_date END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [nextStatus, caseId]
    );

    await query(
      `UPDATE case_assignments
       SET status = 'completed',
           completed_date = CURRENT_TIMESTAMP
       WHERE case_id = $1
         AND doctor_id = (SELECT id FROM doctors WHERE user_id = $2)`,
      [caseId, userId]
    );

    await clearDoctorResponseDraft(caseId, userId);

    if (structuredPayload) {
      try {
        await recordAiDraftEditRatioOnSend({
          caseId,
          questionAnswers: structuredPayload.questionAnswers,
          aiDraftBaselines: structuredPayload.aiDraftBaselines,
          storedDraft: row.response_draft,
        });
      } catch (error) {
        // Metric must not block send success.
        logger.warn('Failed to record ai_draft_edit_ratio', {
          caseId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const io = req.app.get('io');
    io.to(`case-${caseId}`).emit('new-message', messageResult.rows[0]);

    res.status(201).json({
      status: 'success',
      data: {
        message: messageResult.rows[0],
        attachment: attachments[0],
      },
      message: 'Doctor opinion sent with PDF attachment',
    });
  } catch (error) {
    next(error);
  }
};
