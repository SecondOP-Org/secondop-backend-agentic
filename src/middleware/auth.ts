import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../database/connection';
import { AppError } from './errorHandler';

export type AuthUserType = 'patient' | 'doctor' | 'organization';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    type: AuthUserType;
  };
}

interface JwtPayload {
  id: string;
  email: string;
  type: AuthUserType;
}

const isDevSkipAuthEnabled = (): boolean => {
  return process.env.DEV_SKIP_AUTH === 'true' && process.env.NODE_ENV !== 'production';
};

const resolveDevUser = async (): Promise<{ id: string; email: string; type: AuthUserType }> => {
  const configuredType = process.env.DEV_SKIP_AUTH_USER_TYPE;
  const userType: AuthUserType =
    configuredType === 'doctor'
      ? 'doctor'
      : configuredType === 'organization'
        ? 'organization'
        : 'patient';
  const configuredId = process.env.DEV_SKIP_AUTH_USER_ID;

  const byIdResult = configuredId
    ? await query(
        `SELECT id, email, user_type
         FROM users
         WHERE id = $1 AND is_active = true
         LIMIT 1`,
        [configuredId]
      )
    : { rows: [] as Array<{ id: string; email: string | null; user_type: AuthUserType }> };

  const userRow =
    byIdResult.rows[0] ||
    (
      await query(
        `SELECT id, email, user_type
         FROM users
         WHERE user_type = $1 AND is_active = true
         ORDER BY created_at ASC
         LIMIT 1`,
        [userType]
      )
    ).rows[0];

  if (!userRow) {
    throw new AppError(
      `DEV_SKIP_AUTH is enabled but no active ${userType} user exists. Seed or register a user first.`,
      500
    );
  }

  return {
    id: userRow.id,
    email: userRow.email || `${userType}.dev@local`,
    type: userRow.user_type,
  };
};

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    if (isDevSkipAuthEnabled()) {
      req.user = await resolveDevUser();
      next();
      return;
    }

    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;

    if (!token) {
      throw new AppError('Authentication required', 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    const userResult = await query(
      `SELECT id, email, user_type
       FROM users
       WHERE id = $1 AND is_active = true
       LIMIT 1`,
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      throw new AppError('Account is unavailable', 401);
    }

    const user = userResult.rows[0] as { id: string; email: string | null; user_type: AuthUserType };

    req.user = {
      id: user.id,
      email: user.email || decoded.email,
      type: user.user_type,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError('Invalid token', 401));
    }
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppError('Token expired', 401));
    }
    next(error);
  }
};

export const authorize = (...roles: AuthUserType[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!roles.includes(req.user.type)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};
