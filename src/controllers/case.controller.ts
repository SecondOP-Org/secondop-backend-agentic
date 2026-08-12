import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { isCommandCenterOperator } from '../middleware/commandCenterAuth';
import { AppError } from '../middleware/errorHandler';
import { iterateAnalysisProgress } from '../services/analysisProgress.service';
import {
  appendDoctorKeyImage,
  getDoctorResponse,
  saveDoctorResponseDraft,
} from '../services/doctorResponse.service';
import { startCaseReview } from '../services/doctorCaseWorkflow.service';
import { resolveCaseId } from '../utils/caseIdentifier';
import * as caseService from '../services/case.service';
import { suggestCaseTitleForPatient } from '../services/caseTitleSuggest.service';

export { parseSpecialistQuestions } from '../services/case.service';

export const createCase = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const created = await caseService.createCaseForPatient(req.user!.id, req.body);

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
    await caseService.updateCaseIntakeForPatient(caseId, req.user!.id, req.body);

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
    const data = await caseService.queueCaseAnalysisForPatient(caseId, req.user!.id);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getCaseAnalysis = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const includeAgentic = String(req.query.includeAgentic || '').toLowerCase() === 'true';
    const revealPii = String(req.query.reveal_pii || '').toLowerCase() === 'true';
    const data = await caseService.getCaseAnalysisForViewer(
      req.params.caseId,
      req.user!.id,
      req.user!.type,
      includeAgentic,
      isCommandCenterOperator(req.user),
      revealPii
    );

    if (revealPii) {
      res.setHeader('Cache-Control', 'no-store');
    }

    res.json({
      status: 'success',
      data,
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

    await caseService.ensureCaseAccess(caseId, userId, userType);

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
    const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const trace = await caseService.getCaseAnalysisTraceForOperator(req.params.caseId, runId);

    res.json({
      status: 'success',
      data: trace,
    });
  } catch (error) {
    next(error);
  }
};

export const submitCase = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    await caseService.submitCaseForPatient(caseId, req.user!.id, req.body);

    res.json({
      status: 'success',
      message: 'Case submitted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const updateSpecialistQuestions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await caseService.updateSpecialistQuestionsForPatient(
      req.params.caseId,
      req.user!.id,
      req.body
    );

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getCases = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await caseService.getCasesForPatient(req.user!.id, req.query);

    res.json({
      status: 'success',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const getCaseById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const data = await caseService.getCaseByIdForViewer(caseId, req.user!.id, req.user!.type);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCase = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    await caseService.updateCaseForPatient(caseId, req.user!.id, req.body);

    res.json({
      status: 'success',
      message: 'Case updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const suggestCaseTitle = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await suggestCaseTitleForPatient({
      description: req.body?.description,
      areaOfConcern: req.body?.areaOfConcern,
      symptoms: req.body?.symptoms,
    });

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCase = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    await caseService.deleteCaseForPatient(caseId, req.user!.id);

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
    const data = await caseService.assignDoctorToCaseForPatient(
      caseId,
      req.user!.id,
      req.body.doctorId
    );

    res.json({
      status: 'success',
      data,
      message: 'Doctor assigned to case successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorCases = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await caseService.getDoctorCasesForUser(req.user!.id, req.query);

    res.json({
      status: 'success',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorDashboardStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await caseService.getDoctorDashboardStatsForUser(req.user!.id);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const removeDoctorCaseAssignment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    await caseService.removeDoctorCaseAssignmentForUser(caseId, req.user!.id);

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
    await caseService.updateCaseStatusForDoctor(caseId, req.user!.id, req.body.status);

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
    const result = await startCaseReview(caseId, req.user!.id);

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
    await caseService.ensureDoctorAssignedToCase(caseId, req.user!.id);

    const data = await getDoctorResponse(caseId, req.user!.id);

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
    await caseService.ensureDoctorAssignedToCase(caseId, req.user!.id);

    const draft = await saveDoctorResponseDraft(caseId, req.user!.id, req.body);

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
    const result = await caseService.generatePatientFacingAiDraft(
      caseId,
      req.user!.id,
      req.body
    );

    res.json({
      status: 'success',
      data: result,
      message: 'Patient-facing AI draft generated',
    });
  } catch (error) {
    next(error);
  }
};

/** SEC-203 — ChatGPT-style NDJSON token stream for doctor AI draft answers. */
export const streamPatientFacingAiDraftHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { caseId } = req.params;
    const abortController = new AbortController();

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
      abortController.abort();
    });

    try {
      const stream = await caseService.streamPatientFacingAiDraft(
        caseId,
        req.user!.id,
        req.body,
        { signal: abortController.signal }
      );

      for await (const event of stream) {
        if (clientClosed) {
          break;
        }
        res.write(`${JSON.stringify(event)}\n`);
        if (typeof (res as Response & { flush?: () => void }).flush === 'function') {
          (res as Response & { flush: () => void }).flush();
        }
      }
    } catch (error) {
      if (!clientClosed && !res.writableEnded) {
        const message =
          error instanceof Error && error.name === 'AbortError'
            ? 'Stream aborted'
            : error instanceof Error
              ? error.message
              : 'AI draft stream failed';
        res.write(`${JSON.stringify({ type: 'error', message })}\n`);
      }
    }

    if (!res.writableEnded) {
      res.end();
    }
  } catch (error) {
    if (!res.headersSent) {
      next(error);
      return;
    }
    res.end();
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

    await caseService.ensureDoctorAssignedToCase(caseId, userId);

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
    const { pdfBuffer, originalName } = await caseService.previewDoctorOpinionForDoctor(
      caseId,
      req.user!.id,
      req.body
    );

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
    const { message, attachment } = await caseService.sendDoctorOpinionForDoctor(
      caseId,
      req.user!.id,
      req.body
    );

    const io = req.app.get('io');
    io.to(`case-${caseId}`).emit('new-message', message);

    res.status(201).json({
      status: 'success',
      data: {
        message,
        attachment,
      },
      message: 'Doctor opinion sent with PDF attachment',
    });
  } catch (error) {
    next(error);
  }
};
