import { AppError } from '../middleware/errorHandler';
import {
  findCaseForDoctorReview,
  insertCaseReviewStartedMessage,
  updateCaseAssignmentToInReview,
  updateCaseToInReview,
} from '../repositories/case.repository';

const REVIEWABLE_CASE_STATUSES = new Set(['pending']);

export const startCaseReview = async (
  caseId: string,
  doctorUserId: string
): Promise<{ caseId: string; status: string; startedAt: string }> => {
  const assignmentRows = await findCaseForDoctorReview(caseId, doctorUserId);

  if (assignmentRows.length === 0) {
    throw new AppError('Case not found for assigned doctor', 404);
  }

  const row = assignmentRows[0] as {
    id: string;
    status: string;
    title: string;
    patient_user_id: string;
  };

  if (!REVIEWABLE_CASE_STATUSES.has(row.status)) {
    throw new AppError('Case is already in review or completed', 400);
  }

  const startedAt = new Date().toISOString();

  await updateCaseToInReview(caseId);

  await updateCaseAssignmentToInReview(caseId, doctorUserId);

  await insertCaseReviewStartedMessage(
    caseId,
    doctorUserId,
    row.patient_user_id,
    `Your specialist has started reviewing case "${row.title}".`
  );

  return {
    caseId,
    status: 'in_review',
    startedAt,
  };
};
