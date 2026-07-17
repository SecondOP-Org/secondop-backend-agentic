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

/** True when the authenticated user is on the command-center operator allowlist. */
export const isCommandCenterOperator = (user: AuthRequest['user']): boolean => {
  if (!user) {
    return false;
  }

  const allowedIds = parseCsv(process.env.COMMAND_CENTER_OPERATOR_USER_IDS);
  const allowedEmails = parseCsv(process.env.COMMAND_CENTER_OPERATOR_EMAILS);
  if (allowedIds.length === 0 && allowedEmails.length === 0) {
    return false;
  }

  const userId = user.id.toLowerCase();
  const userEmail = user.email.toLowerCase();
  return allowedIds.includes(userId) || allowedEmails.includes(userEmail);
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

  if (allowedIds.length === 0 && allowedEmails.length === 0) {
    logger.warn('Command-center access denied because no operator allowlist is configured', {
      userId: req.user.id,
      requestId: req.requestId,
    });
    return next(new AppError('Command-center operator access is not configured', 403));
  }

  if (!isCommandCenterOperator(req.user)) {
    logger.warn('Command-center access denied for non-operator user', {
      userId: req.user.id,
      requestId: req.requestId,
    });
    return next(new AppError('Insufficient command-center permissions', 403));
  }

  next();
};
