/**
 * Clinical grounding feature flags and specialty gates (SEC-206).
 * Ship dark: GROUNDING_ENABLED defaults false.
 */

const DEFAULT_CLINICAL_TRIALS_SPECIALTY_ALLOWLIST = [
  'oncology',
  'hematology-oncology',
  'rare-disease',
  'medical-genetics',
] as const;

const parseCsv = (raw: string | undefined): string[] =>
  (raw || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

const normalizeSpecialty = (value: string | undefined | null): string =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

export const isGroundingEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  (env.GROUNDING_ENABLED || 'false').trim().toLowerCase() === 'true';

export const getClinicalTrialsSpecialtyAllowlist = (
  env: NodeJS.ProcessEnv = process.env
): string[] => {
  const fromEnv = parseCsv(env.CLINICAL_TRIALS_SPECIALTY_ALLOWLIST);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_CLINICAL_TRIALS_SPECIALTY_ALLOWLIST];
};

export const isClinicalTrialsSpecialtyAllowed = (
  specialtyContext: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  const specialty = normalizeSpecialty(specialtyContext);
  if (!specialty) {
    return false;
  }

  const allowlist = getClinicalTrialsSpecialtyAllowlist(env);
  return allowlist.some(
    (allowed) => specialty === allowed || specialty.includes(allowed) || allowed.includes(specialty)
  );
};

export type GroundingToolName = 'pubmed' | 'clinicalTrials';

/**
 * Tools available for a case given feature flag + specialty gate.
 * When grounding is disabled, returns [].
 */
export const listRegisteredGroundingTools = (input: {
  specialtyContext: string;
  env?: NodeJS.ProcessEnv;
}): GroundingToolName[] => {
  const env = input.env || process.env;
  if (!isGroundingEnabled(env)) {
    return [];
  }

  const tools: GroundingToolName[] = ['pubmed'];
  if (isClinicalTrialsSpecialtyAllowed(input.specialtyContext, env)) {
    tools.push('clinicalTrials');
  }
  return tools;
};

export const GROUNDING_HTTP_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.GROUNDING_HTTP_TIMEOUT_MS || '5000', 10) || 5000
);

export const GROUNDING_CACHE_TTL_MS = Math.max(
  60_000,
  parseInt(process.env.GROUNDING_CACHE_TTL_MS || String(24 * 60 * 60 * 1000), 10) ||
    24 * 60 * 60 * 1000
);
