import {
  createPendingOrganizationWithOwner,
  parseOrganizationSignupInput,
} from '../services/organization.service';
import { AppError } from '../middleware/errorHandler';

describe('organization.service (SEC-173)', () => {
  it('parses organization signup fields', () => {
    const parsed = parseOrganizationSignupInput({
      organizationName: 'Second Opinion Partners LLC',
      firstName: 'Asha',
      lastName: 'Patel',
      email: 'asha@partners.example',
      phone: '+1-555-0100',
      addressLine1: '100 Market St',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94105',
      country: 'United States',
      logoUrl: 'https://cdn.example/logo.png',
    });

    expect(parsed.name).toBe('Second Opinion Partners LLC');
    expect(parsed.contactEmail).toBe('asha@partners.example');
    expect(parsed.addressLine1).toBe('100 Market St');
    expect(parsed.logoUrl).toBe('https://cdn.example/logo.png');
  });

  it('rejects missing organization name', () => {
    expect(() =>
      parseOrganizationSignupInput({
        firstName: 'Asha',
        lastName: 'Patel',
        email: 'asha@partners.example',
        addressLine1: '100 Market St',
        city: 'San Francisco',
        country: 'United States',
      })
    ).toThrow(AppError);
  });

  it('creates pending organization with owner membership', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'org-1',
              name: 'Partners LLC',
              verification_status: 'pending',
              contact_email: 'asha@partners.example',
              created_at: new Date('2026-07-29T00:00:00Z'),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const organization = await createPendingOrganizationWithOwner(
      client as never,
      {
        name: 'Partners LLC',
        contactFirstName: 'Asha',
        contactLastName: 'Patel',
        contactEmail: 'asha@partners.example',
        contactPhone: null,
        addressLine1: '100 Market St',
        addressLine2: null,
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'United States',
        logoUrl: null,
      },
      'user-owner-1'
    );

    expect(organization.verification_status).toBe('pending');
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO organization_members'),
      ['org-1', 'user-owner-1']
    );
  });
});
