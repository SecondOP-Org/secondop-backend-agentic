import { PoolClient, QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findPatientIdByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM patients WHERE user_id = $1', [userId]);
  return result.rows;
};

export const findPatientOwnsCase = async (caseId: string, userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT c.id
     FROM cases c
     JOIN patients p ON p.id = c.patient_id
     WHERE c.id = $1 AND p.user_id = $2`,
    [caseId, userId]
  );
  return result.rows;
};

export const findDoctorAssignedToCase = async (caseId: string, userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT c.id
     FROM cases c
     JOIN case_assignments ca ON ca.case_id = c.id
     JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1 AND d.user_id = $2`,
    [caseId, userId]
  );
  return result.rows;
};

export const findAssignedDoctors = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
  return result.rows;
};

export interface InsertCaseInput {
  caseNumber: string;
  patientId: string;
  title: string;
  description: string;
  specialty: string;
  priority: string;
  urgencyLevel: string;
  status: string;
}

export const insertCase = async (
  input: InsertCaseInput,
  client?: PoolClient
): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO cases (case_number, patient_id, title, description, specialty, priority, urgency_level, status, analysis_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'not_started')
     RETURNING *`,
    [
      input.caseNumber,
      input.patientId,
      input.title,
      input.description,
      input.specialty,
      input.priority,
      input.urgencyLevel,
      input.status,
    ],
    client
  );
  return result.rows[0];
};

export interface InsertCaseIntakeInput {
  caseId: string;
  age: number;
  sex: string;
  specialtyContext: string;
  symptoms: string;
  symptomDuration: string;
  medicalHistory: string;
  currentMedications: string;
  allergies: string;
}

export const insertCaseIntake = async (
  input: InsertCaseIntakeInput,
  client?: PoolClient
): Promise<void> => {
  await dbQuery(
    `INSERT INTO case_intake (case_id, age_at_submission, sex, specialty_context, symptoms, symptom_duration, medical_history, current_medications, allergies)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.caseId,
      input.age,
      input.sex,
      input.specialtyContext,
      input.symptoms,
      input.symptomDuration,
      input.medicalHistory,
      input.currentMedications,
      input.allergies,
    ],
    client
  );
};

export const upsertCaseIntake = async (input: InsertCaseIntakeInput): Promise<void> => {
  await dbQuery(
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
      input.caseId,
      input.age,
      input.sex,
      input.specialtyContext,
      input.symptoms,
      input.symptomDuration,
      input.medicalHistory,
      input.currentMedications,
      input.allergies,
    ]
  );
};

export const updateCaseSpecialty = async (caseId: string, specialty: string): Promise<void> => {
  await dbQuery(
    `UPDATE cases
     SET specialty = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [specialty, caseId]
  );
};

export const findCaseIntakeExists = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT case_id FROM case_intake WHERE case_id = $1', [caseId]);
  return result.rows;
};

export const countEligibleMedicalFiles = async (caseId: string): Promise<number> => {
  const result = await dbQuery(
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
  return result.rows[0].file_count as number;
};

export const findCaseAnalysisFields = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
  return result.rows;
};

export const findCaseSubmitValidation = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
  return result.rows;
};

export const updateCaseOnSubmit = async (
  caseId: string,
  specialistQuestionsJson: string,
  shareAiAnalysisWithSpecialists: boolean,
  turnaroundDays: number
): Promise<void> => {
  await dbQuery(
    `UPDATE cases
     SET specialist_questions = $2,
         share_ai_analysis_with_specialists = $3,
         status = 'pending',
         submitted_date = COALESCE(submitted_date, CURRENT_TIMESTAMP),
         due_date = COALESCE(due_date, CURRENT_TIMESTAMP + ($4::int * INTERVAL '1 day')),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [caseId, specialistQuestionsJson, shareAiAnalysisWithSpecialists, turnaroundDays]
  );
};

export const findCasesForPatient = async (
  patientId: string,
  userId: string,
  pageSize: number,
  offset: number
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
  return result.rows;
};

export const findCaseById = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
  return result.rows;
};

export const findCaseIntake = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT age_at_submission, sex, specialty_context, symptoms, symptom_duration, medical_history, current_medications, allergies
     FROM case_intake
     WHERE case_id = $1`,
    [caseId]
  );
  return result.rows;
};

export const findMedicalFilesForCase = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
  return result.rows;
};

export const updateCaseTitleDescription = async (
  caseId: string,
  title: string | null,
  description: string | null
): Promise<void> => {
  await dbQuery(
    `UPDATE cases
     SET title = COALESCE($1, title),
         description = COALESCE($2, description),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [title, description, caseId]
  );
};

export const deleteCase = async (caseId: string): Promise<void> => {
  await dbQuery('DELETE FROM cases WHERE id = $1', [caseId]);
};

export const insertCaseAssignment = async (caseId: string, doctorId: string): Promise<void> => {
  await dbQuery(
    `INSERT INTO case_assignments (case_id, doctor_id, status)
     VALUES ($1, $2, 'assigned')
     ON CONFLICT (case_id, doctor_id)
     DO NOTHING`,
    [caseId, doctorId]
  );
};

export const findDoctorIdByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM doctors WHERE user_id = $1', [userId]);
  return result.rows;
};

export const findDoctorCases = async (
  doctorId: string,
  statuses: readonly string[],
  turnaroundDays: number,
  pageSize: number,
  offset: number
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
    [doctorId, statuses, turnaroundDays, pageSize, offset]
  );
  return result.rows;
};

export const findDoctorDashboardCaseRows = async (
  doctorId: string,
  turnaroundDays: number,
  statuses: readonly string[]
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT c.status,
            COALESCE(c.due_date, c.submitted_date + ($2::int * INTERVAL '1 day')) AS effective_due_date
     FROM cases c
     JOIN case_assignments ca ON c.id = ca.case_id
     WHERE ca.doctor_id = $1
       AND c.status <> 'draft'
       AND c.status = ANY($3::text[])`,
    [doctorId, turnaroundDays, statuses]
  );
  return result.rows;
};

export const deleteCaseAssignment = async (caseId: string, doctorId: string): Promise<void> => {
  await dbQuery(
    `DELETE FROM case_assignments
     WHERE case_id = $1
       AND doctor_id = $2`,
    [caseId, doctorId]
  );
};

export const updateCaseStatus = async (caseId: string, status: string): Promise<void> => {
  await dbQuery(
    `UPDATE cases
     SET status = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [status, caseId]
  );
};

export const findDoctorOpinionPreviewCase = async (
  caseId: string,
  userId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
  return result.rows;
};

export const findDoctorOpinionSendCase = async (
  caseId: string,
  userId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
  return result.rows;
};

export interface InsertDoctorOpinionMessageInput {
  caseId: string;
  senderId: string;
  receiverId: string;
  content: string;
  attachmentsJson: string;
}

export const insertDoctorOpinionMessage = async (
  input: InsertDoctorOpinionMessageInput
): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO messages (case_id, sender_id, receiver_id, content, message_type, attachments)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.caseId,
      input.senderId,
      input.receiverId,
      input.content,
      'doctor_opinion',
      input.attachmentsJson,
    ]
  );
  return result.rows[0];
};

export const updateCaseOnDoctorOpinionSend = async (
  caseId: string,
  nextStatus: string
): Promise<void> => {
  await dbQuery(
    `UPDATE cases
     SET status = $1,
         completed_date = CASE WHEN $1::text = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_date END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [nextStatus, caseId]
  );
};

export const updateCaseAssignmentOnDoctorOpinionSend = async (
  caseId: string,
  userId: string
): Promise<void> => {
  await dbQuery(
    `UPDATE case_assignments
     SET status = 'completed',
         completed_date = CURRENT_TIMESTAMP
     WHERE case_id = $1
       AND doctor_id = (SELECT id FROM doctors WHERE user_id = $2)`,
    [caseId, userId]
  );
};

export const findCaseForDoctorReview = async (
  caseId: string,
  doctorUserId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT c.id,
            c.status,
            c.title,
            p.user_id AS patient_user_id
     FROM cases c
     JOIN case_assignments ca ON ca.case_id = c.id
     JOIN doctors d ON d.id = ca.doctor_id
     JOIN patients p ON p.id = c.patient_id
     WHERE c.id = $1 AND d.user_id = $2
     LIMIT 1`,
    [caseId, doctorUserId]
  );
  return result.rows;
};

export const updateCaseToInReview = async (caseId: string): Promise<void> => {
  await dbQuery(
    `UPDATE cases
     SET status = 'in_review',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [caseId]
  );
};

export const updateCaseAssignmentToInReview = async (
  caseId: string,
  doctorUserId: string
): Promise<void> => {
  await dbQuery(
    `UPDATE case_assignments
     SET status = 'in_review',
         accepted_date = COALESCE(accepted_date, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE case_id = $1
       AND doctor_id = (SELECT id FROM doctors WHERE user_id = $2)`,
    [caseId, doctorUserId]
  );
};

export const insertCaseReviewStartedMessage = async (
  caseId: string,
  doctorUserId: string,
  patientUserId: string,
  content: string
): Promise<void> => {
  await dbQuery(
    `INSERT INTO messages (case_id, sender_id, receiver_id, content, message_type)
     VALUES ($1, $2, $3, $4, 'system')`,
    [caseId, doctorUserId, patientUserId, content]
  );
};

export const upsertCaseSymptomIntake = async (
  caseId: string,
  payloadJson: string,
  triageLevel: string | null,
  client?: PoolClient
): Promise<void> => {
  await dbQuery(
    `
    INSERT INTO case_symptom_intake (case_id, version, payload, triage_level, updated_at)
    VALUES ($1, 1, $2::jsonb, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (case_id, version)
    DO UPDATE SET
      payload = EXCLUDED.payload,
      triage_level = EXCLUDED.triage_level,
      updated_at = CURRENT_TIMESTAMP
  `,
    [caseId, payloadJson, triageLevel],
    client
  );
};

export const findLatestCaseSymptomIntake = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT payload, triage_level
     FROM case_symptom_intake
     WHERE case_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [caseId]
  );
  return result.rows;
};
