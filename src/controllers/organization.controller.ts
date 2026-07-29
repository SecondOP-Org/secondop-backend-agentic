import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getOrganizationForOwnerUser } from '../services/organization.service';
import { AppError } from '../middleware/errorHandler';

export const getMyOrganization = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user || req.user.type !== 'organization') {
      throw new AppError('Organization account required', 403);
    }

    const organization = await getOrganizationForOwnerUser(req.user.id);
    if (!organization) {
      throw new AppError('Organization not found for this account', 404);
    }

    res.json({
      status: 'success',
      data: { organization },
    });
  } catch (error) {
    next(error);
  }
};

/** Used by tests / health of router mount; register stays on auth.controller. */
export const organizationRegisterProbe = async (_req: Request, res: Response) => {
  res.status(405).json({ status: 'error', message: 'Use POST /auth/register with userType=organization' });
};
