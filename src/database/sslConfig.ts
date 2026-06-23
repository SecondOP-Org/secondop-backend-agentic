import { readFileSync } from 'fs';
import type { ConnectionOptions } from 'tls';

export type DbSslConfig = false | ConnectionOptions;

type Env = NodeJS.ProcessEnv;
type ReadFile = typeof readFileSync;

export const buildDbSslConfig = (
  env: Env = process.env,
  readFile: ReadFile = readFileSync
): DbSslConfig => {
  if (env.DB_SSL !== 'true') {
    return false;
  }

  const rejectUnauthorized = env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  if (!rejectUnauthorized && env.NODE_ENV === 'production') {
    throw new Error('DB_SSL_REJECT_UNAUTHORIZED=false is not allowed when NODE_ENV=production');
  }

  const inlineCa = env.DB_SSL_CA?.trim();
  const caFile = env.DB_SSL_CA_FILE?.trim();
  const ca = inlineCa || (caFile ? readFile(caFile, 'utf8') : undefined);

  return ca ? { rejectUnauthorized, ca } : { rejectUnauthorized };
};
