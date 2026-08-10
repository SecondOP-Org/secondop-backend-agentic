import { Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
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
import {
  ImageRedactionError,
  isImageDeidEnabled,
  redactDicomPixelsInPlace,
  redactImageFileInPlace,
} from '../services/imageRedaction.service';
import { computeFileSha256 } from '../services/fileHash.service';
import {
  paginationMeta,
  parsePaginationQuery,
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
import { isCommandCenterOperator } from '../middleware/commandCenterAuth';
import {
  assertStudyDownloadAccess,
  getCaseMetaForDownload,
  listStudyInstancesForDownload,
  streamStudyZipToResponse,
} from '../services/imagingStudyDownload.service';
import * as fileService from '../services/file.service';

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
  const abortController = new AbortController();
  const onClientGone = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };
  req.on('aborted', onClientGone);
  res.on('close', onClientGone);

  try {
    const { caseId, description } = req.body;
    const userId = req.user!.id;

    if (!caseId || typeof caseId !== 'string') {
      throw new AppError('caseId is required', 400);
    }

    const patientId = await fileService.resolveAccessibleCasePatientId(caseId, userId);
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];
    const singleFile = req.file;
    const ingestOptions = { signal: abortController.signal };

    if (singleFile) {
      const extension = path.extname(singleFile.originalname).toLowerCase();
      const isZip =
        singleFile.mimetype === 'application/zip' ||
        singleFile.mimetype === 'application/x-zip-compressed' ||
        extension === '.zip';

      if (!isZip) {
        throw new AppError('Single-file study upload must be a .zip archive', 400);
      }

      const result = await ingestImagingStudyFromZip(
        {
          caseId,
          patientId,
          userId,
          zipPath: singleFile.path,
          description: typeof description === 'string' ? description : undefined,
        },
        ingestOptions
      );

      res.status(201).json({
        status: 'success',
        data: result,
      });
      return;
    }

    if (uploadedFiles.length > 0) {
      const result = await ingestImagingStudyFromFiles(
        {
          caseId,
          patientId,
          userId,
          files: uploadedFiles,
          description: typeof description === 'string' ? description : undefined,
        },
        ingestOptions
      );

      res.status(201).json({
        status: 'success',
        data: result,
      });
      return;
    }

    throw new AppError('No imaging study files uploaded', 400);
  } catch (error) {
    next(error);
  } finally {
    req.off('aborted', onClientGone);
    res.off('close', onClientGone);
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

    const patientId = await fileService.resolveAccessibleCasePatientId(caseId, userId);
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

    try {
      if (isDicom && isImageDeidEnabled()) {
        await redactDicomPixelsInPlace(filePath);
      } else if (isImage && isImageDeidEnabled()) {
        await redactImageFileInPlace(filePath, req.file.mimetype);
      }
    } catch (error) {
      if (error instanceof ImageRedactionError) {
        throw new AppError(error.message, 503);
      }
      throw error;
    }

    const storedStats = fs.statSync(filePath);
    const fileSha256 = await computeFileSha256(filePath);

    const fileRecord = await fileService.insertMedicalFile({
      caseId,
      patientId,
      uploadedBy: userId,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: storedStats.size,
      fileUrl,
      fileCategory: category,
      description,
      isDicom,
      fileSha256,
      pdfValidationStatus: isReport ? 'pending' : null,
      pdfExtractionStatus: isReport ? 'pending' : null,
    });

    if (isDicom) {
      if (deidResult) {
        await upsertDicomDeidVault({
          fileId: fileRecord.id,
          caseId: fileRecord.case_id!,
          studyInstanceUid: deidResult.remappedStudyUid,
          mapping: deidResult.mapping,
          audit: deidResult.audit,
        });
      }

      await extractAndPersistDicomMetadata({
        fileId: fileRecord.id,
        caseId: fileRecord.case_id!,
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
        caseId: fileRecord.case_id!,
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
    const { rows, total } = await fileService.getFiles(userId, caseId, pageSize, offset);

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
    const file = await fileService.getAccessibleFileById(fileId, req.user!.id);

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
    const file = await fileService.getAccessibleFileById(fileId, req.user!.id);
    const filePath = resolveStoredFilePath(file.file_url);

    if (!fs.existsSync(filePath)) {
      throw new AppError('File not found on server', 404);
    }

    res.download(filePath, file.file_name);
  } catch (error) {
    next(error);
  }
};

/**
 * SEC-126: Stream an entire DICOM study as a ZIP for native workstation reading.
 * Authz: owning patient, assigned doctor, or command-center operator.
 * Serves de-identified stored bytes only — never re-identifies tags.
 */
export const downloadImagingStudy = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId, studyUid } = req.params;
    const user = req.user!;

    if (!caseId || !studyUid) {
      throw new AppError('caseId and studyUid are required', 400);
    }

    await assertStudyDownloadAccess(caseId, user.id, isCommandCenterOperator(user));

    const caseMeta = await getCaseMetaForDownload(caseId);
    const instances = await listStudyInstancesForDownload(caseId, studyUid);

    await streamStudyZipToResponse({
      res,
      caseId: caseMeta.caseId,
      caseNumber: caseMeta.caseNumber,
      studyUid,
      actorUserId: user.id,
      instances,
    });
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

    const file = await fileService.getAccessibleFileById(fileId, userId);
    const isReport = isReportMedicalFile(file.file_type, file.file_name);
    const caseId = file.case_id;

    if (!caseId) {
      throw new AppError('File is not attached to a case', 400);
    }

    await fileService.ensurePatientOwnsDraftCase(caseId, userId);

    const filePath = resolveStoredFilePath(file.file_url);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await fileService.deleteMedicalFileRecord(fileId);

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
    const file = await fileService.getAccessibleFileById(fileId, req.user!.id);
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
    const file = await fileService.getAccessibleFileById(fileId, req.user!.id);

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
