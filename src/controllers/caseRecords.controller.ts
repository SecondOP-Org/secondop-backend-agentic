import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { resolveCaseId } from '../utils/caseIdentifier';
import {
  confirmCaseRecordsIdentity,
  getCaseRecordsStatus,
  startCaseRecordsConnection,
} from '../services/caseRecords.service';

export const connectCaseRecordsHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const caseId = await resolveCaseId(req.params.caseId);
    const data = await startCaseRecordsConnection(caseId, req.user!.id);
    res.status(201).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const confirmCaseRecordsIdentityHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const caseId = await resolveCaseId(req.params.caseId);
    const verificationToken =
      typeof req.body?.verificationToken === 'string' ? req.body.verificationToken : '';
    await confirmCaseRecordsIdentity(caseId, req.user!.id, verificationToken);
    res.json({
      status: 'success',
      data: null,
    });
  } catch (error) {
    next(error);
  }
};

export const getCaseRecordsStatusHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const caseId = await resolveCaseId(req.params.caseId);
    const data = await getCaseRecordsStatus(caseId, req.user!.id);
    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};
