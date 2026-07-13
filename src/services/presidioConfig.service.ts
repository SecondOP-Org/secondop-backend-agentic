const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

export interface PresidioConfig {
  enabled: boolean;
  analyzerUrl: string;
  anonymizerUrl: string;
  minScore: number;
  timeoutMs: number;
  language: string;
  reversibleKeyConfigured: boolean;
}

export const getPresidioConfig = (): PresidioConfig => ({
  enabled: parseBoolean(process.env.DEID_ENABLED, false),
  analyzerUrl: (process.env.PRESIDIO_ANALYZER_URL || 'http://localhost:5002').replace(/\/$/, ''),
  anonymizerUrl: (process.env.PRESIDIO_ANONYMIZER_URL || 'http://localhost:5001').replace(/\/$/, ''),
  minScore: parseNumber(process.env.PRESIDIO_MIN_SCORE, 0.5),
  timeoutMs: parseNumber(process.env.PRESIDIO_TIMEOUT_MS, 10000),
  language: process.env.PRESIDIO_LANGUAGE?.trim() || 'en',
  reversibleKeyConfigured: Boolean(process.env.DEID_REVERSIBLE_KEY?.trim()),
});
