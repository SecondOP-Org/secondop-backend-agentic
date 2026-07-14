import { Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import {
  extractAndPersistDicomMetadata,
  getPersistedAnnotations,
  parseDicomAnnotations,
  parseDicomViewport,
  savePersistedAnnotations,
} from '../services/dicomImaging.service';
import {
  ingestImagingStudyFromFiles,
  ingestImagingStudyFromZip,
} from '../services/imagingStudyIngest.service';
import {
  createDicomDeidContext,
  deidentifyDicomFileInPlace,
  isDicomDeidEnabled,
  upsertDicomDeidVault,
} from '../services/dicomDeidentification.service';
import { computeFileSha256 } from '../services/fileHash.service';
import {
  paginationMeta,
  parsePaginationQuery,
  splitTotalCount,
} from '../utils/pagination';
import {
  invalidateCaseAnalysisAfterPdfChange,
  isImageMedicalFile,
  isPdfMedicalFile,
  isReportMedicalFile,
  updatePdfValidationStatus,
} from '../services/medicalFileAnalysis.service';
import { queueReportExtraction } from '../services/reportExtractionBackground.service';
import { validateImageUpload, validatePdfUpload } from '../services/reportExtraction.service';
import { resolveStoredFilePath } from '../utils/uploadPath';

interface AuthorizedFileRow {
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

const findAccessibleCasePatientId = async (caseId: string, userId: string): Promise<string> => {
  const result = await query(
    `SELECT c.patient_id
     FROM cases c
     JOIN patients p ON p.id = c.patient_id
     LEFT JOIN case_assignments ca ON ca.case_id = c.id
     LEFT JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1
       AND (p.user_id = $2 OR d.user_id = $2)
     LIMIT 1`,
    [caseId, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Case not found or access denied', 403);
  }

  return result.rows[0].patient_id;
};

const getAccessibleFileById = async (fileId: string, userId: string): Promise<AuthorizedFileRow> => {
  const result = await query(
    `SELECT mf.*,
            di.dicom_extraction_status,
            di.dicom_extraction_error
     FROM medical_files mf
     JOIN patients p ON p.id = mf.patient_id
     LEFT JOIN cases c ON c.id = mf.case_id
     LEFT JOIN case_assignments ca ON ca.case_id = c.id
     LEFT JOIN doctors d ON d.id = ca.doctor_id
     LEFT JOIN dicom_instances di ON di.file_id = mf.id
     WHERE mf.id = $1
       AND (p.user_id = $2 OR d.user_id = $2)
     ORDER BY mf.created_at DESC
     LIMIT 1`,
    [fileId, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('File not found or access denied', 404);
  }

  return result.rows[0] as AuthorizedFileRow;
};

const ensurePatientOwnsDraftCase = async (caseId: string, userId: string): Promise<void> => {
  const result = await query(
    `SELECT c.status
     FROM cases c
     JOIN patients p ON p.id = c.patient_id
     WHERE c.id = $1
       AND p.user_id = $2`,
    [caseId, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Case not found or access denied', 403);
  }

  const status = String(result.rows[0].status || '');
  if (status !== 'draft') {
    throw new AppError('Files can only be deleted while the case is still a draft', 403);
  }
};

const isDicomUpload = (file: Express.Multer.File): boolean => {
  const extension = path.extname(file.originalname).toLowerCase();
  return (
    file.mimetype === 'application/dicom' ||
    file.mimetype === 'application/x-dicom' ||
    ((file.mimetype === 'application/octet-stream' || file.mimetype === 'application/dcm') &&
      (extension === '.dcm' || extension === '.dicom'))
  );
};

export const uploadImagingStudy = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId, description } = req.body;
    const userId = req.user!.id;

    if (!caseId || typeof caseId !== 'string') {
      throw new AppError('caseId is required', 400);
    }

    const patientId = await findAccessibleCasePatientId(caseId, userId);
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];
    const singleFile = req.file;

    if (singleFile) {
      const extension = path.extname(singleFile.originalname).toLowerCase();
      const isZip =
        singleFile.mimetype === 'application/zip' ||
        singleFile.mimetype === 'application/x-zip-compressed' ||
        extension === '.zip';

      if (!isZip) {
        throw new AppError('Single-file study upload must be a .zip archive', 400);
      }

      const result = await ingestImagingStudyFromZip({
        caseId,
        patientId,
        userId,
        zipPath: singleFile.path,
        description: typeof description === 'string' ? description : undefined,
      });

      res.status(201).json({
        status: 'success',
        data: result,
      });
      return;
    }

    if (uploadedFiles.length > 0) {
      const result = await ingestImagingStudyFromFiles({
        caseId,
        patientId,
        userId,
        files: uploadedFiles,
        description: typeof description === 'string' ? description : undefined,
      });

      res.status(201).json({
        status: 'success',
        data: result,
      });
      return;
    }

    throw new AppError('No imaging study files uploaded', 400);
  } catch (error) {
    next(error);
  }
};

export const uploadFile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const { caseId, category, description } = req.body;
    const userId = req.user!.id;

    if (!caseId || typeof caseId !== 'string') {
      throw new AppError('caseId is required', 400);
    }

    const patientId = await findAccessibleCasePatientId(caseId, userId);
    const fileUrl = `/uploads/${req.file.filename}`;
    const isDicom = isDicomUpload(req.file);
    const isPdf = isPdfMedicalFile(req.file.mimetype, req.file.originalname);
    const isImage = isImageMedicalFile(req.file.mimetype, req.file.originalname);
    const isReport = isReportMedicalFile(req.file.mimetype, req.file.originalname);
    const filePath = resolveStoredFilePath(fileUrl);

    let deidResult: Awaited<ReturnType<typeof deidentifyDicomFileInPlace>> | null = null;
    if (isDicom && isDicomDeidEnabled()) {
      deidResult = await deidentifyDicomFileInPlace(filePath, createDicomDeidContext(caseId));
    }

    const storedStats = fs.statSync(filePath);
    const fileSha256 = await computeFileSha256(filePath);

    const result = await query(
      `INSERT INTO medical_files (
        case_id,
        patient_id,
        uploaded_by,
        file_name,
        file_type,
        file_size,
        file_url,
        file_category,
        description,
        is_dicom,
        file_sha256,
        pdf_validation_status,
        pdf_extraction_status
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        caseId,
        patientId,
        userId,
        req.file.originalname,
        req.file.mimetype,
        storedStats.size,
        fileUrl,
        category,
        description,
        isDicom,
        fileSha256,
        isReport ? 'pending' : null,
        isReport ? 'pending' : null,
      ]
    );

    const fileRecord = result.rows[0] as {
      id: string;
      case_id: string;
      file_name: string;
      file_type: string;
      file_url: string;
    };

    if (isDicom) {
      if (deidResult) {
        await upsertDicomDeidVault({
          fileId: fileRecord.id,
          caseId: fileRecord.case_id,
          studyInstanceUid: deidResult.remappedStudyUid,
          mapping: deidResult.mapping,
          audit: deidResult.audit,
        });
      }

      await extractAndPersistDicomMetadata({
        fileId: fileRecord.id,
        caseId: fileRecord.case_id,
        filePath,
      });
    } else if (isReport) {
      if (isPdf) {
        const validation = await validatePdfUpload(filePath);
        await updatePdfValidationStatus(
          fileRecord.id,
          validation.valid ? 'succeeded' : 'failed',
          validation.error
        );
      } else if (isImage) {
        const validation = await validateImageUpload(filePath, req.file.mimetype);
        await updatePdfValidationStatus(
          fileRecord.id,
          validation.valid ? 'succeeded' : 'failed',
          validation.error
        );
      }

      await invalidateCaseAnalysisAfterPdfChange(caseId);
      queueReportExtraction({
        caseId: fileRecord.case_id,
        fileSha256,
        row: {
          id: fileRecord.id,
          file_name: fileRecord.file_name,
          file_type: fileRecord.file_type,
          file_url: fileRecord.file_url,
          file_sha256: fileSha256,
          pdf_validation_status: 'pending',
          pdf_validation_error: null,
          pdf_extraction_status: 'pending',
          pdf_extraction_error: null,
          pdf_extracted_at: null,
        },
      });
    }

    res.status(201).json({
      status: 'success',
      data: fileRecord,
    });
  } catch (error) {
    next(error);
  }
};

export const getFiles = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.query;
    const userId = req.user!.id;
    const { page, pageSize, offset } = parsePaginationQuery(req.query);
    const params: unknown[] = [userId];
    let innerWhere = 'WHERE (p.user_id = $1 OR d.user_id = $1)';

    if (caseId && typeof caseId !== 'string') {
      throw new AppError('caseId must be a string', 400);
    }

    if (caseId) {
      params.push(caseId);
      innerWhere += ` AND mf.case_id = $${params.length}`;
    }

    params.push(pageSize, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    // DISTINCT in a subquery avoids join fan-out before LIMIT/OFFSET + total count.
    const queryStr = `
      SELECT paged.*, COUNT(*) OVER() AS __total_count
      FROM (
        SELECT DISTINCT mf.*,
               di.dicom_extraction_status,
               di.dicom_extraction_error
        FROM medical_files mf
        JOIN patients p ON p.id = mf.patient_id
        LEFT JOIN cases c ON c.id = mf.case_id
        LEFT JOIN case_assignments ca ON ca.case_id = c.id
        LEFT JOIN doctors d ON d.id = ca.doctor_id
        LEFT JOIN dicom_instances di ON di.file_id = mf.id
        ${innerWhere}
      ) paged
      ORDER BY paged.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const result = await query(queryStr, params);
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

export const getFileById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fileId } = req.params;
    const file = await getAccessibleFileById(fileId, req.user!.id);

    res.json({
      status: 'success',
      data: file,
    });
  } catch (error) {
    next(error);
  }
};

export const downloadFile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fileId } = req.params;
    const file = await getAccessibleFileById(fileId, req.user!.id);
    const filePath = resolveStoredFilePath(file.file_url);

    if (!fs.existsSync(filePath)) {
      throw new AppError('File not found on server', 404);
    }

    res.download(filePath, file.file_name);
  } catch (error) {
    next(error);
  }
};

export const deleteFile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fileId } = req.params;
    const userId = req.user!.id;

    if (req.user!.type !== 'patient') {
      throw new AppError('Only patients can delete uploaded case files', 403);
    }

    const file = await getAccessibleFileById(fileId, userId);
    const isReport = isReportMedicalFile(file.file_type, file.file_name);
    const caseId = file.case_id;

    if (!caseId) {
      throw new AppError('File is not attached to a case', 400);
    }

    await ensurePatientOwnsDraftCase(caseId, userId);

    const filePath = resolveStoredFilePath(file.file_url);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await query('DELETE FROM medical_files WHERE id = $1', [fileId]);

    const analysisInvalidated = isReport ? await invalidateCaseAnalysisAfterPdfChange(caseId) : false;

    res.json({
      status: 'success',
      message: 'File deleted successfully',
      data: {
        caseId,
        analysisInvalidated,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getFileAnnotations = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fileId } = req.params;
    const file = await getAccessibleFileById(fileId, req.user!.id);
    const persisted = await getPersistedAnnotations(file.id);

    res.json({
      status: 'success',
      data: persisted || {
        fileId: file.id,
        annotations: [],
        viewport: null,
        sopInstanceUid: null,
        updatedAt: null,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const saveFileAnnotations = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fileId } = req.params;
    const file = await getAccessibleFileById(fileId, req.user!.id);

    const annotations = parseDicomAnnotations(req.body.annotations);
    const viewport = parseDicomViewport(req.body.viewport);
    const sopInstanceUid =
      typeof req.body.sopInstanceUid === 'string' && req.body.sopInstanceUid.trim()
        ? req.body.sopInstanceUid.trim()
        : null;

    const persisted = await savePersistedAnnotations({
      fileId: file.id,
      caseId: file.case_id || '',
      savedBy: req.user!.id,
      sopInstanceUid,
      annotations,
      viewport,
    });

    res.json({
      status: 'success',
      data: persisted,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('annotations') || error.message.includes('viewport'))
    ) {
      next(new AppError(error.message, 400));
      return;
    }

    next(error);
  }
};
