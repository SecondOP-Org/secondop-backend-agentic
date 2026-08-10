import { AppError } from '../middleware/errorHandler';
import * as fileRepository from '../repositories/file.repository';
import { splitTotalCount } from '../utils/pagination';

export interface AuthorizedFileRow {
  id: string;
  case_id: string | null;
  patient_id: string;
  uploaded_by: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  file_category: string | null;
  description: string | null;
  metadata: unknown;
  is_dicom: boolean;
  dicom_extraction_status?: 'pending' | 'succeeded' | 'failed' | null;
  dicom_extraction_error?: string | null;
  created_at: string;
  updated_at: string;
}

export const resolveAccessibleCasePatientId = async (caseId: string, userId: string): Promise<string> => {
  const rows = await fileRepository.findAccessibleCasePatientId(caseId, userId);
  if (rows.length === 0) {
    throw new AppError('Case not found or access denied', 403);
  }
  return rows[0].patient_id as string;
};

export const getAccessibleFileById = async (fileId: string, userId: string): Promise<AuthorizedFileRow> => {
  const rows = await fileRepository.getAccessibleFileById(fileId, userId);
  if (rows.length === 0) {
    throw new AppError('File not found or access denied', 404);
  }
  return rows[0] as AuthorizedFileRow;
};

export const ensurePatientOwnsDraftCase = async (caseId: string, userId: string): Promise<void> => {
  const rows = await fileRepository.findPatientDraftCaseStatus(caseId, userId);
  if (rows.length === 0) {
    throw new AppError('Case not found or access denied', 403);
  }

  const status = String(rows[0].status || '');
  if (status !== 'draft') {
    throw new AppError('Files can only be deleted while the case is still a draft', 403);
  }
};

export const insertMedicalFile = async (
  input: fileRepository.InsertMedicalFileInput
): Promise<AuthorizedFileRow> => {
  const row = await fileRepository.insertMedicalFile(input);
  return row as AuthorizedFileRow;
};

export const getFiles = async (
  userId: string,
  caseId: unknown,
  pageSize: number,
  offset: number
) => {
  if (caseId && typeof caseId !== 'string') {
    throw new AppError('caseId must be a string', 400);
  }

  const rows = await fileRepository.listMedicalFiles(
    userId,
    typeof caseId === 'string' ? caseId : undefined,
    pageSize,
    offset
  );
  return splitTotalCount(rows as Array<Record<string, unknown>>);
};

export const deleteMedicalFileRecord = async (fileId: string): Promise<void> => {
  await fileRepository.deleteMedicalFile(fileId);
};
