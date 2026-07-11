import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { extractObservationsFromSummary } from '../services/analysis.service';
import {
  artifactQuestionsToStrings,
  extractObservationsFromArtifact,
  hydrateCaseAnalysisArtifact,
} from '../services/analysisArtifact.service';
import { toLegacyExecutionMode } from '../agentic/core/executionMode';
import { getLatestAnalysisRun, getLatestAnalysisRunByEngine, getLatestShadowResultByCaseId } from '../services/analysisRun.service';
import { getCaseRunTrace } from '../agentic/observability/analysisObservability.service';
import { analysisWorker } from '../services/analysisWorker.service';
import { getImagingStudiesForCase } from '../services/dicomImaging.service';
import { generateDoctorOpinionPdf } from '../services/doctorOpinionPdf.service';

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
  userType: 'patient' | 'doctor'
): Promise<void> => {
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

    const caseNumber = `SO-${uuidv4()}`;

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
         AND (file_type = 'application/pdf' OR LOWER(file_name) LIKE '%.pdf')`,
      [caseId]
    );

    const fileCount = filesResult.rows[0].file_count as number;
    if (fileCount < 1) {
      throw new AppError('At least one PDF file is required before analysis', 400);
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
    const { caseId } = req.params;
    const userId = req.user!.id;
    const userType = req.user!.type;
    const includeAgentic = String(req.query.includeAgentic || "").toLowerCase() === "true";

    await ensureCaseAccess(caseId, userId, userType);

    const result = await query(
      `SELECT analysis_status, analysis_summary, analysis_questions, analysis_artifact, analysis_model, analysis_error
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
    };

    const latestRun = await getLatestAnalysisRun(caseId);
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
      error: row.analysis_error,
      analysisRunId: latestRun?.id || null,
      observations,
    };

    if (includeAgentic) {
      const latestAgenticRun = await getLatestAnalysisRunByEngine(caseId, "agentic");
      const latestShadow = await getLatestShadowResultByCaseId(caseId);

      payload.agenticRunId = latestAgenticRun?.id || null;
      payload.agenticShadowStatus = latestAgenticRun?.status || "not_run";
      payload.agenticCriticScore = latestShadow?.critic_score_json || null;
      payload.executionMode = latestAgenticRun?.execution_mode || null;
      payload.agenticMode = latestAgenticRun
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

export const getCaseAnalysisTrace = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user!.id;
    const userType = req.user!.type;
    const runId = typeof req.query.runId === "string" ? req.query.runId : undefined;

    await ensureCaseAccess(caseId, userId, userType);

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

    if (row.analysis_status === 'queued' || row.analysis_status === 'processing') {
      throw new AppError(
        'AI analysis is still running. Wait for it to finish, or it will be attached automatically.',
        409
      );
    }

    await query(
      `UPDATE cases
       SET specialist_questions = $2,
           status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [caseId, JSON.stringify(specialistQuestions)]
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

    const result = await query(
      `SELECT c.*,
              ci.age_at_submission,
              ci.sex,
              ci.specialty_context,
              COALESCE(assigned_doctors.assigned_doctors, '[]'::json) AS assigned_doctors,
              latest_message.latest_message_preview,
              latest_message.latest_message_created_at,
              latest_message.latest_message_sender_name,
              COALESCE(latest_message.has_unread_messages, false) AS has_unread_messages
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
       ORDER BY c.submitted_date DESC`,
      [patientId, userId]
    );

    res.json({
      status: 'success',
      data: result.rows,
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

    res.json({
      status: 'success',
      data: {
        ...caseResult.rows[0],
        intake: intakeResult.rows[0] || null,
        files: filesResult.rows,
        imagingStudies,
        assigned_doctors: assignedDoctors,
      },
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

    const doctorExists = await query('SELECT id FROM doctors WHERE id = $1', [doctorId]);
    if (doctorExists.rows.length === 0) {
      throw new AppError('Doctor not found', 404);
    }

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

export const getDoctorCases = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

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
              p.last_name as patient_last_name
       FROM cases c
       JOIN case_assignments ca ON c.id = ca.case_id
       JOIN patients p ON p.id = c.patient_id
       LEFT JOIN case_intake ci ON ci.case_id = c.id
       WHERE ca.doctor_id = $1
       ORDER BY ca.assigned_date DESC`,
      [doctorId]
    );

    res.json({
      status: 'success',
      data: result.rows,
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

export const sendDoctorOpinion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const { content, status } = req.body;
    const userId = req.user!.id;

    if (typeof content !== 'string' || !content.trim()) {
      throw new AppError('content is required', 400);
    }

    const nextStatus = typeof status === 'string' && status.trim() ? status.trim() : 'completed';

    await ensureDoctorAssignedToCase(caseId, userId);

    const caseResult = await query(
      `SELECT c.id, c.title, c.case_number, c.submitted_date,
              p.user_id as patient_user_id,
              p.first_name as patient_first_name,
              p.last_name as patient_last_name,
              d.first_name as doctor_first_name,
              d.last_name as doctor_last_name,
              d.specialty as doctor_specialty
       FROM cases c
       JOIN patients p ON p.id = c.patient_id
       JOIN case_assignments ca ON ca.case_id = c.id
       JOIN doctors d ON d.id = ca.doctor_id
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

    const pdfFile = await generateDoctorOpinionPdf({
      caseTitle: row.title,
      caseNumber: row.case_number,
      patientName,
      doctorName,
      doctorSpecialty: row.doctor_specialty || '',
      clinicalResponse: content.trim(),
      submittedDate: row.submitted_date,
    });

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
        content.trim(),
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
