import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';
import { AppError } from '../middleware/errorHandler';
import {
  buildOrganizationInviteEmail,
  getAppPublicUrl,
  isEmailConfigured,
  queueEmail,
} from './email.service';
import * as organizationRepo from '../repositories/organization.repository';

export type OrganizationVerificationStatus = organizationRepo.OrganizationVerificationStatus;
export type OrganizationMemberRole = 'owner' | 'member';

export type CreateOrganizationInput = organizationRepo.InsertPendingOrganizationInput;

const hashSecret = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${field} is required`, 400);
  }
  return value.trim();
};

const optionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** Validate and normalize public org signup payload. */
export const parseOrganizationSignupInput = (body: Record<string, unknown>): CreateOrganizationInput => {
  return {
    name: requiredString(body.organizationName ?? body.companyName, 'Organization name'),
    contactFirstName: requiredString(body.firstName, 'Contact first name'),
    contactLastName: requiredString(body.lastName, 'Contact last name'),
    contactEmail: requiredString(body.email, 'Contact email'),
    contactPhone: optionalString(body.phone ?? body.contactPhone),
    addressLine1: requiredString(body.addressLine1, 'Address line 1'),
    addressLine2: optionalString(body.addressLine2),
    city: requiredString(body.city, 'City'),
    state: optionalString(body.state),
    postalCode: optionalString(body.postalCode),
    country: requiredString(body.country, 'Country'),
    logoUrl: optionalString(body.logoUrl),
  };
};

/** Insert pending organization and owner membership inside an open transaction. */
export const createPendingOrganizationWithOwner = async (
  client: PoolClient,
  input: CreateOrganizationInput,
  ownerUserId: string
) => {
  const organization = await organizationRepo.insertPendingOrganization(input, client);

  await organizationRepo.insertOrganizationOwnerMember(
    organization.id as string,
    ownerUserId,
    client
  );

  return organization as {
    id: string;
    name: string;
    verification_status: OrganizationVerificationStatus;
    contact_email: string;
    created_at: Date;
  };
};

export const getOrganizationForOwnerUser = async (userId: string) => {
  return organizationRepo.findOrganizationForOwnerUser(userId);
};

export const createOrganizationInvite = async (input: {
  ownerUserId: string;
  email: string;
}) => {
  const email = requiredString(input.email, 'Email').toLowerCase();
  const membership = await getOrganizationForOwnerUser(input.ownerUserId);
  if (!membership) {
    throw new AppError('Organization not found for this account', 404);
  }
  if (membership.role !== 'owner') {
    throw new AppError('Only organization owners can invite doctors', 403);
  }
  if (membership.verification_status !== 'verified') {
    throw new AppError(
      'Organization must be verified before inviting doctors',
      403
    );
  }

  const token = uuidv4();
  const tokenHash = hashSecret(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Replace any prior pending invite for the same email.
  await organizationRepo.revokePendingInvitesForEmail(membership.id as string, email);

  const invite = await organizationRepo.insertOrganizationInvite({
    organizationId: membership.id as string,
    email,
    invitedBy: input.ownerUserId,
    tokenHash,
    expiresAt,
  });

  let emailQueued = false;
  if (isEmailConfigured()) {
    const inviteUrl = `${getAppPublicUrl()}/accept-invite?token=${encodeURIComponent(token)}`;
    const mail = buildOrganizationInviteEmail({
      organizationName: membership.name as string,
      inviteUrl,
    });
    queueEmail({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    emailQueued = true;
  }

  return {
    invite: {
      id: invite.id,
      email: invite.email,
      status: invite.status,
      expiresAt: invite.expires_at,
      createdAt: invite.created_at,
      organizationName: membership.name,
    },
    emailQueued,
    // Returned only so tests / local debug can accept without SMTP; never log in production handlers.
    acceptToken: token,
  };
};

export const listOrganizationInvitesForOwner = async (ownerUserId: string) => {
  const membership = await getOrganizationForOwnerUser(ownerUserId);
  if (!membership) {
    throw new AppError('Organization not found for this account', 404);
  }

  return organizationRepo.listOrganizationInvitesByOrganizationId(membership.id as string);
};

export const getOrganizationInvitePreview = async (rawToken: string) => {
  const token = requiredString(rawToken, 'Invite token');
  const row = await organizationRepo.findOrganizationInviteByTokenHash(hashSecret(token));

  if (!row) {
    throw new AppError('Invite not found', 404);
  }

  if (row.status !== 'pending') {
    throw new AppError('Invite is no longer valid', 410);
  }
  if (new Date(row.expires_at as Date).getTime() < Date.now()) {
    await organizationRepo.expireOrganizationInvite(row.id as string);
    throw new AppError('Invite has expired', 410);
  }
  if (row.organization_verification_status !== 'verified') {
    throw new AppError('Organization is not verified', 403);
  }

  return {
    email: row.email,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    expiresAt: row.expires_at,
  };
};

/**
 * Validates invite for doctor registration and returns organization id.
 * Caller must insert doctor + member, then markAcceptedOrganizationInvite.
 */
export const resolveInviteForDoctorRegistration = async (
  client: PoolClient,
  input: { inviteToken: string; email: string }
) => {
  const token = requiredString(input.inviteToken, 'Invite token');
  const email = requiredString(input.email, 'Email').toLowerCase();
  const row = await organizationRepo.findOrganizationInviteForRegistration(
    hashSecret(token),
    client
  );

  if (!row) {
    throw new AppError('Invite not found', 404);
  }

  if (row.status !== 'pending') {
    throw new AppError('Invite is no longer valid', 410);
  }
  if (new Date(row.expires_at as Date).getTime() < Date.now()) {
    await organizationRepo.expireOrganizationInvite(row.id as string, client);
    throw new AppError('Invite has expired', 410);
  }
  if ((row.email as string).toLowerCase() !== email) {
    throw new AppError('Invite email does not match registration email', 400);
  }
  if (row.organization_verification_status !== 'verified') {
    throw new AppError('Organization is not verified', 403);
  }

  return {
    inviteId: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
  };
};

export const markOrganizationInviteAccepted = async (
  client: PoolClient,
  inviteId: string,
  userId: string
) => {
  await organizationRepo.markOrganizationInviteAccepted(inviteId, userId, client);
};

export const listOrganizationsForVerification = async (
  status?: OrganizationVerificationStatus
) => {
  return organizationRepo.listOrganizationsForVerification(status);
};

export const setOrganizationVerificationStatus = async (input: {
  organizationId: string;
  toStatus: 'verified' | 'rejected';
  actorUserId: string;
  reason?: string | null;
}) => {
  const { organizationId, toStatus, actorUserId } = input;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';

  if (toStatus === 'rejected' && !reason) {
    throw new AppError('A reason is required when rejecting an organization', 400);
  }

  const existing = await organizationRepo.findOrganizationVerificationStatus(organizationId);
  if (!existing) {
    throw new AppError('Organization not found', 404);
  }

  return organizationRepo.updateOrganizationVerificationStatus({
    organizationId,
    toStatus,
    actorUserId,
    reason: reason || null,
  });
};
