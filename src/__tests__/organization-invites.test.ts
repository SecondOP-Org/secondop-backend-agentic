import crypto from 'crypto';
import {
  createOrganizationInvite,
  getOrganizationInvitePreview,
  resolveInviteForDoctorRegistration,
  setOrganizationVerificationStatus,
} from '../services/organization.service';
import { AppError } from '../middleware/errorHandler';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../services/email.service', () => ({
  buildOrganizationInviteEmail: jest.fn(() => ({
    subject: 'invite',
    text: 'text',
    html: '<p>html</p>',
  })),
  getAppPublicUrl: jest.fn(() => 'https://app.example'),
  isEmailConfigured: jest.fn(() => false),
  queueEmail: jest.fn(),
}));

import { query } from '../database/connection';

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('organization invites (SEC-170)', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('rejects invite creation when organization is not verified', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'org-1',
          name: 'Partners LLC',
          verification_status: 'pending',
          role: 'owner',
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never);

    await expect(
      createOrganizationInvite({ ownerUserId: 'owner-1', email: 'doc@example.com' })
    ).rejects.toMatchObject({
      message: 'Organization must be verified before inviting doctors',
      statusCode: 403,
    });
  });

  it('creates invite for verified org owner', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'org-1',
            name: 'Partners LLC',
            verification_status: 'verified',
            role: 'owner',
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            email: 'doc@example.com',
            status: 'pending',
            expires_at: new Date('2026-08-05T00:00:00Z'),
            created_at: new Date('2026-07-29T00:00:00Z'),
          },
        ],
      } as never);

    const result = await createOrganizationInvite({
      ownerUserId: 'owner-1',
      email: 'Doc@Example.com',
    });

    expect(result.invite.email).toBe('doc@example.com');
    expect(result.invite.organizationName).toBe('Partners LLC');
    expect(result.acceptToken).toBeTruthy();
    expect(result.emailQueued).toBe(false);
  });

  it('previews a valid pending invite', async () => {
    const token = 'token-abc';
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'inv-1',
          email: 'doc@example.com',
          status: 'pending',
          expires_at: new Date(Date.now() + 60_000),
          organization_id: 'org-1',
          organization_name: 'Partners LLC',
          organization_verification_status: 'verified',
        },
      ],
    } as never);

    const preview = await getOrganizationInvitePreview(token);
    expect(preview.organizationName).toBe('Partners LLC');
    expect(preview.email).toBe('doc@example.com');
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('organization_invites'),
      [tokenHash]
    );
  });

  it('resolves invite for matching doctor email', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            email: 'doc@example.com',
            status: 'pending',
            expires_at: new Date(Date.now() + 60_000),
            organization_id: 'org-1',
            organization_verification_status: 'verified',
            organization_name: 'Partners LLC',
          },
        ],
      }),
    };

    const resolved = await resolveInviteForDoctorRegistration(client as never, {
      inviteToken: 'tok',
      email: 'DOC@example.com',
    });

    expect(resolved.organizationId).toBe('org-1');
    expect(resolved.inviteId).toBe('inv-1');
  });

  it('rejects invite resolve on email mismatch', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            email: 'doc@example.com',
            status: 'pending',
            expires_at: new Date(Date.now() + 60_000),
            organization_id: 'org-1',
            organization_verification_status: 'verified',
            organization_name: 'Partners LLC',
          },
        ],
      }),
    };

    await expect(
      resolveInviteForDoctorRegistration(client as never, {
        inviteToken: 'tok',
        email: 'other@example.com',
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('requires a reason when rejecting an organization', async () => {
    await expect(
      setOrganizationVerificationStatus({
        organizationId: 'org-1',
        toStatus: 'rejected',
        actorUserId: 'admin-1',
      })
    ).rejects.toMatchObject({
      message: 'A reason is required when rejecting an organization',
      statusCode: 400,
    });
  });
});
