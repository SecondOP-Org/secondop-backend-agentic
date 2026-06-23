import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const REQUEST_ID_HEADER = 'X-Request-ID';

const MAX_REQUEST_ID_LENGTH = 200;

export const normalizeRequestId = (requestId: unknown): string | null => {
  if (typeof requestId !== 'string') {
    return null;
  }

  const sanitized = requestId.trim().replace(/[\r\n\t]/g, '');
  if (!sanitized) {
    return null;
  }

  return sanitized.slice(0, MAX_REQUEST_ID_LENGTH);
};

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = normalizeRequestId(req.get(REQUEST_ID_HEADER)) || uuidv4();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
};
