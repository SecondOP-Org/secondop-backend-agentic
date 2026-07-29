import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import {
  buildOrganizationInviteEmail,
  getAppPublicUrl,
  isEmailConfigured,
  queueEmail,
} from './email.service';

export type OrganizationVerificationStatus = 'pending' | 'verified' | 'rejected';
export type OrganizationMemberRole = 'owner' | 'member';

export type CreateOrganizationInput = {
  name: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  country: string;
  logoUrl?: string | null;
};

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
  const orgResult = await client.query(
    `INSERT INTO organizations (
       name, contact_first_name, contact_last_name, contact_email, contact_phone,
       address_line1, address_line2, city, state, postal_code, country, logo_url,
       verification_status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
     RETURNING id, name, verification_status, contact_email, created_at`,
    [
      input.name,
      input.contactFirstName,
      input.contactLastName,
      input.contactEmail,
      input.contactPhone,
      input.addressLine1,
      input.addressLine2,
      input.city,
      input.state,
      input.postalCode,
      input.country,
      input.logoUrl,
    ]
  );

  const organization = orgResult.rows[0] as {
    id: string;
    name: string;
    verification_status: OrganizationVerificationStatus;
    contact_email: string;
    created_at: Date;
  };

  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [organization.id, ownerUserId]
  );

  return organization;
};

export const getOrganizationForOwnerUser = async (userId: string) => {
  const result = await query(
    `SELECT o.id, o.name, o.verification_status, o.verification_reason, o.created_at,
            om.role
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     WHERE om.user_id = $1
     ORDER BY
       CASE om.role WHEN 'owner' THEN 0 ELSE 1 END,
       o.created_at ASC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
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
  await query(
    `UPDATE organization_invites
     SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1
       AND lower(email) = $2
       AND status = 'pending'`,
    [membership.id, email]
  );

  const inserted = await query(
    `INSERT INTO organization_invites (
       organization_id, email, invited_by, token_hash, status, expires_at
     )
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id, email, status, expires_at, created_at`,
    [membership.id, email, input.ownerUserId, tokenHash, expiresAt]
  );

  const invite = inserted.rows[0] as {
    id: string;
    email: string;
    status: string;
    expires_at: Date;
    created_at: Date;
  };

  let emailQueued = false;
  if (isEmailConfigured()) {
    const inviteUrl = `${getAppPublicUrl()}/accept-invite?token=${encodeURIComponent(token)}`;
    const mail = buildOrganizationInviteEmail({
      organizationName: membership.name,
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

  const result = await query(
    `SELECT id, email, status, expires_at, accepted_at, created_at
     FROM organization_invites
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [membership.id]
  );

  return result.rows;
};

export const getOrganizationInvitePreview = async (rawToken: string) => {
  const token = requiredString(rawToken, 'Invite token');
  const result = await query(
    `SELECT i.id, i.email, i.status, i.expires_at, o.id AS organization_id, o.name AS organization_name,
            o.verification_status AS organization_verification_status
     FROM organization_invites i
     JOIN organizations o ON o.id = i.organization_id
     WHERE i.token_hash = $1
     LIMIT 1`,
    [hashSecret(token)]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invite not found', 404);
  }

  const row = result.rows[0] as {
    id: string;
    email: string;
    status: string;
    expires_at: Date;
    organization_id: string;
    organization_name: string;
    organization_verification_status: OrganizationVerificationStatus;
  };

  if (row.status !== 'pending') {
    throw new AppError('Invite is no longer valid', 410);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query(
      `UPDATE organization_invites SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [row.id]
    );
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
  const result = await client.query(
    `SELECT i.id, i.email, i.status, i.expires_at, i.organization_id,
            o.verification_status AS organization_verification_status, o.name AS organization_name
     FROM organization_invites i
     JOIN organizations o ON o.id = i.organization_id
     WHERE i.token_hash = $1
     LIMIT 1
     FOR UPDATE OF i`,
    [hashSecret(token)]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invite not found', 404);
  }

  const row = result.rows[0] as {
    id: string;
    email: string;
    status: string;
    expires_at: Date;
    organization_id: string;
    organization_verification_status: OrganizationVerificationStatus;
    organization_name: string;
  };

  if (row.status !== 'pending') {
    throw new AppError('Invite is no longer valid', 410);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await client.query(
      `UPDATE organization_invites SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [row.id]
    );
    throw new AppError('Invite has expired', 410);
  }
  if (row.email.toLowerCase() !== email) {
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
  await client.query(
    `UPDATE organization_invites
     SET status = 'accepted',
         accepted_user_id = $2,
         accepted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [inviteId, userId]
  );
};

export const listOrganizationsForVerification = async (
  status?: OrganizationVerificationStatus
) => {
  const params: string[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE o.verification_status = $1`;
  }

  const result = await query(
    `SELECT o.id, o.name, o.contact_first_name, o.contact_last_name, o.contact_email,
            o.contact_phone, o.city, o.country, o.verification_status, o.verification_reason,
            o.verified_at, o.verified_by, o.created_at
     FROM organizations o
     ${where}
     ORDER BY
       CASE o.verification_status
         WHEN 'pending' THEN 0
         WHEN 'rejected' THEN 1
         ELSE 2
       END,
       o.created_at ASC`,
    params
  );

  return result.rows;
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

  const existing = await query(
    `SELECT id, verification_status FROM organizations WHERE id = $1 LIMIT 1`,
    [organizationId]
  );
  if (existing.rows.length === 0) {
    throw new AppError('Organization not found', 404);
  }

  const updated = await query(
    `UPDATE organizations
     SET verification_status = $1,
         verification_reason = $2,
         verified_at = CASE WHEN $1 = 'verified' THEN CURRENT_TIMESTAMP ELSE verified_at END,
         verified_by = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING id, name, contact_email, verification_status, verification_reason,
               verified_at, verified_by, created_at`,
    [toStatus, reason || null, actorUserId, organizationId]
  );

  return updated.rows[0];
};
