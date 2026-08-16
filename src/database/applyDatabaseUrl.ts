/**
 * Map DATABASE_URL onto the discrete DB_* env vars used by connection.ts.
 * Must run before the pool module is imported.
 */
export const applyDatabaseUrlToDbEnv = (
  databaseUrl: string,
  env: NodeJS.ProcessEnv = process.env
): void => {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be a postgres or postgresql URL.');
  }

  const host = parsed.hostname;
  if (!host) {
    throw new Error('DATABASE_URL is missing a host.');
  }

  if (host.endsWith('.railway.internal') || host === 'railway.internal') {
    throw new Error(
      'DATABASE_URL uses *.railway.internal, which is not reachable from GitHub Actions. Use the public Postgres proxy URL.'
    );
  }

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
  if (!dbName) {
    throw new Error('DATABASE_URL is missing a database name.');
  }

  env.DB_HOST = host;
  env.DB_PORT = parsed.port || '5432';
  env.DB_USER = decodeURIComponent(parsed.username);
  env.DB_PASSWORD = decodeURIComponent(parsed.password);
  env.DB_NAME = dbName;

  const sslmode = (parsed.searchParams.get('sslmode') || '').toLowerCase();
  const publicProxy = host.endsWith('rlwy.net') || host.endsWith('railway.app');
  if ((sslmode && sslmode !== 'disable') || publicProxy) {
    env.DB_SSL = 'true';
  }
  if (publicProxy && env.NODE_ENV !== 'production' && env.DB_SSL_REJECT_UNAUTHORIZED !== 'true') {
    env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
  }
  if (!env.DB_CONNECTION_TIMEOUT_MS) {
    env.DB_CONNECTION_TIMEOUT_MS = '15000';
  }
};
