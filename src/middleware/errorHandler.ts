import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const isPostgresError = (err: unknown): err is Error & { code?: string } =>
  Boolean(err && typeof err === 'object' && 'code' in err && typeof (err as { code?: string }).code === 'string');

const mapPostgresError = (err: Error & { code?: string }): AppError | null => {
  switch (err.code) {
    case '22P02':
      return new AppError(
        'Invalid case ID format. Use the case UUID or case number (for example, SO-ABC12345).',
        400
      );
    case '42703':
      return new AppError(
        'Database schema is out of date for analysis observability. Run pending migrations (011+).',
        503
      );
    case '42P01':
      return new AppError(
        'Database schema is out of date for analysis observability. Run pending migrations (012+).',
        503
      );
    default:
      return null;
  }
};

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestId = req.requestId;

  if (!(err instanceof AppError) && isPostgresError(err)) {
    const mapped = mapPostgresError(err);
    if (mapped) {
      err = mapped;
    }
  }

  if (err instanceof AppError) {
    logger.error(`AppError: ${err.message}`, {
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
      requestId,
    });

    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      requestId,
    });
  }

  // Handle unexpected errors
  logger.error('Unexpected error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId,
  });

  return res.status(500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    requestId,
  });
};
