import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';

const REVIEWABLE_CASE_STATUSES = new Set(['pending']);

export const startCaseReview = async (
  caseId: string,
  doctorUserId: string
): Promise<{ caseId: string; status: string; startedAt: string }> => {
  const assignmentResult = await query(
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

  if (assignmentResult.rows.length === 0) {
    throw new AppError('Case not found for assigned doctor', 404);
  }

  const row = assignmentResult.rows[0] as {
    id: string;
    status: string;
    title: string;
    patient_user_id: string;
  };

  if (!REVIEWABLE_CASE_STATUSES.has(row.status)) {
    throw new AppError('Case is already in review or completed', 400);
  }

  const startedAt = new Date().toISOString();

  await query(
    `UPDATE cases
     SET status = 'in_review',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [caseId]
  );

  await query(
    `UPDATE case_assignments
     SET status = 'in_review',
         accepted_date = COALESCE(accepted_date, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE case_id = $1
       AND doctor_id = (SELECT id FROM doctors WHERE user_id = $2)`,
    [caseId, doctorUserId]
  );

  await query(
    `INSERT INTO messages (case_id, sender_id, receiver_id, content, message_type)
     VALUES ($1, $2, $3, $4, 'system')`,
    [
      caseId,
      doctorUserId,
      row.patient_user_id,
      `Your specialist has started reviewing case "${row.title}".`,
    ]
  );

  return {
    caseId,
    status: 'in_review',
    startedAt,
  };
};
