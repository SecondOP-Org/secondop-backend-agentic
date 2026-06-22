import { buildDbSslConfig } from '../database/sslConfig';

describe('buildDbSslConfig', () => {
  it('disables SSL when DB_SSL is not true', () => {
    expect(buildDbSslConfig({ DB_SSL: 'false' })).toBe(false);
    expect(buildDbSslConfig({})).toBe(false);
  });

  it('enables certificate verification by default when DB_SSL is true', () => {
    expect(buildDbSslConfig({ DB_SSL: 'true' })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('uses inline CA material when provided', () => {
    expect(buildDbSslConfig({ DB_SSL: 'true', DB_SSL_CA: '---CERT---' })).toEqual({
      rejectUnauthorized: true,
      ca: '---CERT---',
    });
  });

  it('uses CA file material when provided', () => {
    const readFile = jest.fn().mockReturnValue('---FILE CERT---');

    expect(
      buildDbSslConfig(
        { DB_SSL: 'true', DB_SSL_CA_FILE: '/secure/db-ca.pem' },
        readFile as never
      )
    ).toEqual({
      rejectUnauthorized: true,
      ca: '---FILE CERT---',
    });
    expect(readFile).toHaveBeenCalledWith('/secure/db-ca.pem', 'utf8');
  });

  it('allows disabling certificate verification outside production only', () => {
    expect(
      buildDbSslConfig({
        DB_SSL: 'true',
        DB_SSL_REJECT_UNAUTHORIZED: 'false',
        NODE_ENV: 'development',
      })
    ).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('rejects disabled certificate verification in production', () => {
    expect(() =>
      buildDbSslConfig({
        DB_SSL: 'true',
        DB_SSL_REJECT_UNAUTHORIZED: 'false',
        NODE_ENV: 'production',
      })
    ).toThrow('DB_SSL_REJECT_UNAUTHORIZED=false is not allowed when NODE_ENV=production');
  });
});
