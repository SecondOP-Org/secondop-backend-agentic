import { PoolClient } from 'pg';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';

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
