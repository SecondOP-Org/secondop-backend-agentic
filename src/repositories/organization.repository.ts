import { PoolClient, QueryResultRow } from 'pg';
import { dbQuery } from './db';

export type OrganizationVerificationStatus = 'pending' | 'verified' | 'rejected';

export interface InsertPendingOrganizationInput {
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
}

export const insertPendingOrganization = async (
  input: InsertPendingOrganizationInput,
  client: PoolClient
): Promise<QueryResultRow> => {
  const orgResult = await dbQuery(
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
    ],
    client
  );
  return orgResult.rows[0];
};

export const insertOrganizationOwnerMember = async (
  organizationId: string,
  ownerUserId: string,
  client: PoolClient
): Promise<void> => {
  await dbQuery(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [organizationId, ownerUserId],
    client
  );
};

export const findOrganizationForOwnerUser = async (userId: string): Promise<QueryResultRow | null> => {
  const result = await dbQuery(
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

export const revokePendingInvitesForEmail = async (
  organizationId: string,
  email: string
): Promise<void> => {
  await dbQuery(
    `UPDATE organization_invites
     SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1
       AND lower(email) = $2
       AND status = 'pending'`,
    [organizationId, email]
  );
};

export interface InsertOrganizationInviteInput {
  organizationId: string;
  email: string;
  invitedBy: string;
  tokenHash: string;
  expiresAt: Date;
}

export const insertOrganizationInvite = async (
  input: InsertOrganizationInviteInput
): Promise<QueryResultRow> => {
  const inserted = await dbQuery(
    `INSERT INTO organization_invites (
       organization_id, email, invited_by, token_hash, status, expires_at
     )
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id, email, status, expires_at, created_at`,
    [input.organizationId, input.email, input.invitedBy, input.tokenHash, input.expiresAt]
  );
  return inserted.rows[0];
};

export const listOrganizationInvitesByOrganizationId = async (
  organizationId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT id, email, status, expires_at, accepted_at, created_at
     FROM organization_invites
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [organizationId]
  );
  return result.rows;
};

export const findOrganizationInviteByTokenHash = async (
  tokenHash: string
): Promise<QueryResultRow | null> => {
  const result = await dbQuery(
    `SELECT i.id, i.email, i.status, i.expires_at, o.id AS organization_id, o.name AS organization_name,
            o.verification_status AS organization_verification_status
     FROM organization_invites i
     JOIN organizations o ON o.id = i.organization_id
     WHERE i.token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] ?? null;
};

export const expireOrganizationInvite = async (
  inviteId: string,
  client?: PoolClient
): Promise<void> => {
  await dbQuery(
    `UPDATE organization_invites SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [inviteId],
    client
  );
};

export const findOrganizationInviteForRegistration = async (
  tokenHash: string,
  client: PoolClient
): Promise<QueryResultRow | null> => {
  const result = await dbQuery(
    `SELECT i.id, i.email, i.status, i.expires_at, i.organization_id,
            o.verification_status AS organization_verification_status, o.name AS organization_name
     FROM organization_invites i
     JOIN organizations o ON o.id = i.organization_id
     WHERE i.token_hash = $1
     LIMIT 1
     FOR UPDATE OF i`,
    [tokenHash],
    client
  );
  return result.rows[0] ?? null;
};

export const markOrganizationInviteAccepted = async (
  inviteId: string,
  userId: string,
  client: PoolClient
): Promise<void> => {
  await dbQuery(
    `UPDATE organization_invites
     SET status = 'accepted',
         accepted_user_id = $2,
         accepted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [inviteId, userId],
    client
  );
};

export const listOrganizationsForVerification = async (
  status?: OrganizationVerificationStatus
): Promise<QueryResultRow[]> => {
  const params: string[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE o.verification_status = $1`;
  }

  const result = await dbQuery(
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

export const findOrganizationVerificationStatus = async (
  organizationId: string
): Promise<QueryResultRow | null> => {
  const existing = await dbQuery(
    `SELECT id, verification_status FROM organizations WHERE id = $1 LIMIT 1`,
    [organizationId]
  );
  return existing.rows[0] ?? null;
};

export interface UpdateOrganizationVerificationStatusInput {
  organizationId: string;
  toStatus: 'verified' | 'rejected';
  actorUserId: string;
  reason: string | null;
}

export const updateOrganizationVerificationStatus = async (
  input: UpdateOrganizationVerificationStatusInput
): Promise<QueryResultRow> => {
  const updated = await dbQuery(
    `UPDATE organizations
     SET verification_status = $1,
         verification_reason = $2,
         verified_at = CASE WHEN $1 = 'verified' THEN CURRENT_TIMESTAMP ELSE verified_at END,
         verified_by = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING id, name, contact_email, verification_status, verification_reason,
               verified_at, verified_by, created_at`,
    [input.toStatus, input.reason, input.actorUserId, input.organizationId]
  );
  return updated.rows[0];
};
