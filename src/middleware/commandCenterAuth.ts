import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { AppError } from './errorHandler';
import logger from '../utils/logger';

const parseCsv = (value: string | undefined): string[] => {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

export const authorizeCommandCenterOperator = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  const allowedIds = parseCsv(process.env.COMMAND_CENTER_OPERATOR_USER_IDS);
  const allowedEmails = parseCsv(process.env.COMMAND_CENTER_OPERATOR_EMAILS);
  const userId = req.user.id.toLowerCase();
  const userEmail = req.user.email.toLowerCase();

  if (allowedIds.length === 0 && allowedEmails.length === 0) {
    logger.warn('Command-center access denied because no operator allowlist is configured', {
      userId: req.user.id,
      requestId: req.requestId,
    });
    return next(new AppError('Command-center operator access is not configured', 403));
  }

  if (!allowedIds.includes(userId) && !allowedEmails.includes(userEmail)) {
    logger.warn('Command-center access denied for non-operator user', {
      userId: req.user.id,
      requestId: req.requestId,
    });
    return next(new AppError('Insufficient command-center permissions', 403));
  }

  next();
};
