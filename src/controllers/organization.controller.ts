import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  createOrganizationInvite,
  getOrganizationForOwnerUser,
  getOrganizationInvitePreview,
  listOrganizationInvitesForOwner,
  listOrganizationsForVerification,
  OrganizationVerificationStatus,
  setOrganizationVerificationStatus,
} from '../services/organization.service';

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

export const createMyOrganizationInvite = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user || req.user.type !== 'organization') {
      throw new AppError('Organization account required', 403);
    }

    const { email } = req.body as { email?: string };
    const result = await createOrganizationInvite({
      ownerUserId: req.user.id,
      email: email || '',
    });

    res.status(201).json({
      status: 'success',
      data: {
        invite: result.invite,
        emailQueued: result.emailQueued,
        // Dev/test aid when SMTP is off; omit token when email was queued.
        acceptToken: result.emailQueued ? undefined : result.acceptToken,
      },
      message: 'Invite created',
    });
  } catch (error) {
    next(error);
  }
};

export const listMyOrganizationInvites = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user || req.user.type !== 'organization') {
      throw new AppError('Organization account required', 403);
    }

    const invites = await listOrganizationInvitesForOwner(req.user.id);
    res.json({ status: 'success', data: { invites } });
  } catch (error) {
    next(error);
  }
};

export const previewOrganizationInvite = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token =
      typeof req.params.token === 'string'
        ? req.params.token
        : typeof req.query.token === 'string'
          ? req.query.token
          : '';
    const preview = await getOrganizationInvitePreview(token);
    res.json({ status: 'success', data: { invite: preview } });
  } catch (error) {
    next(error);
  }
};

const parseOrgStatus = (value: unknown): OrganizationVerificationStatus | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === 'pending' || value === 'verified' || value === 'rejected') {
    return value;
  }
  throw new AppError('status must be pending, verified, or rejected', 400);
};

export const listOrganizationVerifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const status = parseOrgStatus(req.query.status);
    const organizations = await listOrganizationsForVerification(status);
    res.json({ status: 'success', data: organizations });
  } catch (error) {
    next(error);
  }
};

export const updateOrganizationVerification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { organizationId } = req.params;
    const { status: toStatus, reason } = req.body as {
      status?: string;
      reason?: string;
    };

    if (toStatus !== 'verified' && toStatus !== 'rejected') {
      throw new AppError('status must be verified or rejected', 400);
    }

    const organization = await setOrganizationVerificationStatus({
      organizationId,
      toStatus,
      actorUserId: req.user!.id,
      reason,
    });

    res.json({
      status: 'success',
      data: organization,
      message: `Organization marked ${toStatus}`,
    });
  } catch (error) {
    next(error);
  }
};
