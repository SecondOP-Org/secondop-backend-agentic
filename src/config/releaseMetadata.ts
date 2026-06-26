import { readFileSync } from 'fs';
import path from 'path';

export interface ReleaseMetadata {
  productVersion: string;
  backendVersion: string;
  gitSha: string;
  buildTime: string;
  environment: string;
  apiVersion: string;
  deploymentId: string;
}

const UNKNOWN = 'unknown';

const firstValue = (keys: string[], env: NodeJS.ProcessEnv): string | undefined => {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }

  return undefined;
};

const safeValue = (value: string | undefined, pattern: RegExp, fallback = UNKNOWN): string => {
  if (!value) return fallback;
  return pattern.test(value) ? value : fallback;
};

const readPackageVersion = (): string => {
  try {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof packageJson.version === 'string' && packageJson.version.trim()
      ? packageJson.version.trim()
      : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
};

export const getReleaseMetadata = (env: NodeJS.ProcessEnv = process.env): ReleaseMetadata => {
  const productVersion = safeValue(
    firstValue(['SECONDOP_RELEASE_VERSION', 'APP_VERSION'], env),
    /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/,
    '0.0.0-dev'
  );
  const backendVersion = safeValue(
    firstValue(['BACKEND_PACKAGE_VERSION', 'npm_package_version'], env),
    /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/,
    readPackageVersion()
  );
  const gitSha = safeValue(
    firstValue(['BACKEND_GIT_SHA', 'GIT_SHA', 'RAILWAY_GIT_COMMIT_SHA', 'SOURCE_COMMIT'], env),
    /^[0-9a-fA-F]{7,40}$/
  );
  const buildTime = safeValue(
    firstValue(['BACKEND_BUILD_TIME', 'BUILD_TIME', 'RAILWAY_DEPLOYMENT_CREATED_AT'], env),
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-Z]{8,40}$/
  );
  const environment = safeValue(
    firstValue(['APP_ENV', 'NODE_ENV'], env),
    /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/,
    'development'
  );
  const apiVersion = safeValue(env.API_VERSION, /^v[0-9]+$/, 'v1');
  const deploymentId = safeValue(
    firstValue(['BACKEND_DEPLOYMENT_ID', 'RAILWAY_DEPLOYMENT_ID'], env),
    /^[0-9A-Za-z][0-9A-Za-z_.:-]{0,127}$/
  );

  return {
    productVersion,
    backendVersion,
    gitSha,
    buildTime,
    environment,
    apiVersion,
    deploymentId,
  };
};
