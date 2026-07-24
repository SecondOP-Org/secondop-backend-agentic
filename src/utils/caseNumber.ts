import { v4 as uuidv4 } from 'uuid';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Short patient-facing reference, e.g. SO-A1B2C3D4 */
export const generateCaseNumber = (): string => {
  const suffix = uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `SO-${suffix}`;
};

/**
 * Normalize any stored case_number / id into a short customer-facing ref.
 * Never returns a bare UUID or `SO-` + full UUID. Preserves human labels
 * (SO-SEED-…, SO-DEMO-…, SO-1001) and already-short SO-XXXXXXXX values.
 */
export const toPatientFacingCaseRef = (
  raw?: string | null,
  fallbackId?: string | null
): string => {
  const candidate = (raw ?? '').trim() || (fallbackId ?? '').trim();
  if (!candidate) {
    return 'SO-UNKNOWN';
  }

  if (UUID_RE.test(candidate)) {
    return `SO-${candidate.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  const soMatch = candidate.match(/^SO-?(.+)$/i);
  if (soMatch) {
    const rest = soMatch[1].trim();
    const compact = rest.replace(/-/g, '');

    if (UUID_RE.test(rest) || /^[0-9a-f]{32}$/i.test(compact)) {
      return `SO-${compact.slice(0, 8).toUpperCase()}`;
    }

    if (/^[0-9a-f]{8}$/i.test(compact) && !rest.includes('-')) {
      return `SO-${compact.toUpperCase()}`;
    }

    return `SO-${rest}`;
  }

  const compactOnly = candidate.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(compactOnly)) {
    return `SO-${compactOnly.slice(0, 8).toUpperCase()}`;
  }

  return candidate;
};
