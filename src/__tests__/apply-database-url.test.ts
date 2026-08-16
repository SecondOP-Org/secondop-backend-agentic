import { applyDatabaseUrlToDbEnv } from '../database/applyDatabaseUrl';

describe('applyDatabaseUrlToDbEnv', () => {
  it('maps a public Railway proxy URL onto DB_* env', () => {
    const env: NodeJS.ProcessEnv = {};
    applyDatabaseUrlToDbEnv(
      'postgresql://gold_user:p%40ss@proxy.rlwy.net:23456/secondop_db?sslmode=require',
      env
    );

    expect(env.DB_HOST).toBe('proxy.rlwy.net');
    expect(env.DB_PORT).toBe('23456');
    expect(env.DB_USER).toBe('gold_user');
    expect(env.DB_PASSWORD).toBe('p@ss');
    expect(env.DB_NAME).toBe('secondop_db');
    expect(env.DB_SSL).toBe('true');
    expect(env.DB_SSL_REJECT_UNAUTHORIZED).toBe('false');
    expect(env.DB_CONNECTION_TIMEOUT_MS).toBe('15000');
  });

  it('rejects railway.internal hosts', () => {
    expect(() =>
      applyDatabaseUrlToDbEnv('postgresql://u:p@postgres.railway.internal:5432/secondop_db', {})
    ).toThrow(/railway\.internal/);
  });

  it('does not override NODE_ENV=production TLS verification', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    applyDatabaseUrlToDbEnv('postgresql://u:p@proxy.rlwy.net:1234/db?sslmode=require', env);
    expect(env.DB_SSL).toBe('true');
    expect(env.DB_SSL_REJECT_UNAUTHORIZED).toBeUndefined();
  });
});
