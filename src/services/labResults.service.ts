import { AppError } from '../middleware/errorHandler';
import * as labResultsRepository from '../repositories/labResults.repository';

export const addLabResult = async (
  userId: string,
  patientId: string,
  caseId: string,
  testName: string,
  testType: string,
  results: unknown,
  referenceRange: string,
  unit: string,
  status?: string,
  notes?: string
) => {
  return labResultsRepository.insertLabResult({
    patientId,
    caseId,
    orderedBy: userId,
    testName,
    testType,
    results,
    referenceRange,
    unit,
    status: status || 'pending',
    notes: notes || '',
  });
};

export const getLabResults = async (userId: string) => {
  const patientResult = await labResultsRepository.findPatientIdByUserId(userId);
  const patientId = patientResult[0].id;

  return labResultsRepository.findLabResultsByPatientId(patientId);
};

export const getLabResultById = async (labResultId: string) => {
  const rows = await labResultsRepository.findLabResultById(labResultId);

  if (rows.length === 0) {
    throw new AppError('Lab result not found', 404);
  }

  return rows[0];
};

export const updateLabResult = async (
  labResultId: string,
  results?: unknown,
  status?: string,
  notes?: string
) => {
  await labResultsRepository.updateLabResult({ labResultId, results, status, notes });
};

export const deleteLabResult = async (labResultId: string) => {
  await labResultsRepository.deleteLabResult(labResultId);
};
