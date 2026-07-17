import logger from '../utils/logger';
import {
  analyzeText,
  decryptPayload,
  encryptPayload,
  PresidioAnalyzerResult,
  PresidioClientError,
} from './presidio.client';
import { getPresidioConfig } from './presidioConfig.service';
import { MEDICAL_AD_HOC_RECOGNIZERS } from './presidioRecognizers';
import {
  incrementFailClosed,
  incrementPhiEntitiesDetected,
} from '../observability/phoenix.service';

/** token → original PHI value. Server-side only; never log or return to clients. */
export type DeidentificationMapping = Record<string, string>;

export interface DeidentificationEntitySummary {
  entityType: string;
  count: number;
  maxScore: number;
  minScore: number;
}

export interface DeidentificationAudit {
  enabled: boolean;
  operator: 'token_replace' | 'passthrough';
  language: string;
  minScore: number;
  entityCount: number;
  entities: DeidentificationEntitySummary[];
  timestamp: string;
}

export interface DeidentificationResult {
  deidentifiedText: string;
  mapping: DeidentificationMapping;
  entities: PresidioAnalyzerResult[];
  audit: DeidentificationAudit;
  /** AES-GCM sealed mapping when DEID_REVERSIBLE_KEY is set. */
  sealedMapping: string | null;
}

/**
 * Clinical / medical terms that must not be redacted even if a recognizer
 * mislabels them (e.g. drug brand vs PERSON). Exact whole-span match, case-insensitive.
 */
const CLINICAL_DENY_LIST = new Set(
  [
    'aspirin',
    'ibuprofen',
    'acetaminophen',
    'metformin',
    'insulin',
    'warfarin',
    'heparin',
    'lisinopril',
    'atorvastatin',
    'diabetes',
    'hypertension',
    'asthma',
    'pneumonia',
    'covid',
    'covid-19',
    'mri',
    'ct',
    'ecg',
    'ekg',
    'cbc',
    'bun',
    'creatinine',
    'troponin',
    'hemoglobin',
    'platelet',
  ].map((term) => term.toLowerCase())
);

const TOKEN_PATTERN = /<[A-Z][A-Z0-9_]*_\d+>/g;

const buildPassthroughAudit = (enabled: boolean): DeidentificationAudit => ({
  enabled,
  operator: 'passthrough',
  language: getPresidioConfig().language,
  minScore: getPresidioConfig().minScore,
  entityCount: 0,
  entities: [],
  timestamp: new Date().toISOString(),
});

const summarizeEntities = (entities: PresidioAnalyzerResult[]): DeidentificationEntitySummary[] => {
  const byType = new Map<string, DeidentificationEntitySummary>();

  for (const entity of entities) {
    const existing = byType.get(entity.entity_type);
    if (!existing) {
      byType.set(entity.entity_type, {
        entityType: entity.entity_type,
        count: 1,
        maxScore: entity.score,
        minScore: entity.score,
      });
      continue;
    }

    existing.count += 1;
    existing.maxScore = Math.max(existing.maxScore, entity.score);
    existing.minScore = Math.min(existing.minScore, entity.score);
  }

  return Array.from(byType.values()).sort((a, b) => a.entityType.localeCompare(b.entityType));
};

const sealMappingIfConfigured = (mapping: DeidentificationMapping): string | null => {
  const secret = process.env.DEID_REVERSIBLE_KEY?.trim();
  if (!secret || Object.keys(mapping).length === 0) {
    return null;
  }

  return encryptPayload(JSON.stringify(mapping), secret);
};

export const unsealMapping = (sealed: string): DeidentificationMapping => {
  const secret = process.env.DEID_REVERSIBLE_KEY?.trim();
  if (!secret) {
    throw new Error('DEID_REVERSIBLE_KEY is required to unseal a de-identification mapping.');
  }

  const parsed = JSON.parse(decryptPayload(sealed, secret)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Sealed de-identification mapping is invalid.');
  }

  const mapping: DeidentificationMapping = {};
  for (const [token, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      mapping[token] = value;
    }
  }
  return mapping;
};

const spansOverlap = (a: PresidioAnalyzerResult, b: PresidioAnalyzerResult): boolean => {
  return a.start < b.end && b.start < a.end;
};

/**
 * Drop overlapping analyzer hits. Prefer higher score, then longer span, then
 * left-most start — otherwise token replacement corrupts the string
 * (e.g. EMAIL_ADDRESS overlapping URL on the same email).
 */
export const resolveOverlappingEntities = (
  results: PresidioAnalyzerResult[]
): PresidioAnalyzerResult[] => {
  const ranked = [...results].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aLen = a.end - a.start;
    const bLen = b.end - b.start;
    if (bLen !== aLen) {
      return bLen - aLen;
    }
    return a.start - b.start;
  });

  const selected: PresidioAnalyzerResult[] = [];
  for (const candidate of ranked) {
    if (selected.some((existing) => spansOverlap(existing, candidate))) {
      continue;
    }
    selected.push(candidate);
  }

  return selected.sort((a, b) => a.start - b.start || a.end - b.end);
};

export const filterAnalyzerResults = (
  text: string,
  results: PresidioAnalyzerResult[],
  minScore: number
): PresidioAnalyzerResult[] => {
  const filtered = results.filter((result) => {
    if (!Number.isFinite(result.score) || result.score < minScore) {
      return false;
    }

    if (
      !Number.isInteger(result.start) ||
      !Number.isInteger(result.end) ||
      result.start < 0 ||
      result.end <= result.start ||
      result.end > text.length
    ) {
      return false;
    }

    const span = text.slice(result.start, result.end).trim().toLowerCase();
    if (!span || CLINICAL_DENY_LIST.has(span)) {
      return false;
    }

    return true;
  });

  return resolveOverlappingEntities(filtered);
};

/**
 * Build reversible unique tokens from analyzer spans.
 * Identical (type + value) spans share a token so the LLM stays consistent.
 */
export const buildTokenizedText = (
  text: string,
  entities: PresidioAnalyzerResult[]
): { text: string; mapping: DeidentificationMapping } => {
  const sorted = [...entities].sort((a, b) => b.start - a.start || b.end - a.end);
  const valueToToken = new Map<string, string>();
  const typeCounters = new Map<string, number>();
  const mapping: DeidentificationMapping = {};
  let result = text;

  for (const entity of sorted) {
    const original = text.slice(entity.start, entity.end);
    const key = `${entity.entity_type}::${original}`;
    let token = valueToToken.get(key);

    if (!token) {
      const next = (typeCounters.get(entity.entity_type) || 0) + 1;
      typeCounters.set(entity.entity_type, next);
      token = `<${entity.entity_type}_${next}>`;
      valueToToken.set(key, token);
      mapping[token] = original;
    }

    result = `${result.slice(0, entity.start)}${token}${result.slice(entity.end)}`;
  }

  return { text: result, mapping };
};

export const mergeMappings = (
  ...maps: Array<DeidentificationMapping | undefined | null>
): DeidentificationMapping => {
  const merged: DeidentificationMapping = {};
  for (const map of maps) {
    if (!map) {
      continue;
    }
    Object.assign(merged, map);
  }
  return merged;
};

export const reidentifyText = (text: string, mapping: DeidentificationMapping): string => {
  if (!text || Object.keys(mapping).length === 0) {
    return text;
  }

  const tokens = Object.keys(mapping).sort((a, b) => b.length - a.length);
  let result = text;
  for (const token of tokens) {
    if (!token || result.indexOf(token) === -1) {
      continue;
    }
    result = result.split(token).join(mapping[token]);
  }
  return result;
};

export const containsDeidTokens = (text: string): boolean => {
  TOKEN_PATTERN.lastIndex = 0;
  return TOKEN_PATTERN.test(text);
};

export const deidentifyText = async (text: string): Promise<DeidentificationResult> => {
  const config = getPresidioConfig();

  if (!config.enabled) {
    return {
      deidentifiedText: text,
      mapping: {},
      entities: [],
      audit: buildPassthroughAudit(false),
      sealedMapping: null,
    };
  }

  if (!config.reversibleKeyConfigured) {
    incrementFailClosed({ reason: 'missing_reversible_key' });
    throw new Error(
      'DEID_ENABLED=true requires DEID_REVERSIBLE_KEY so token maps can be sealed for crash-safe re-identification.'
    );
  }

  if (!text.trim()) {
    return {
      deidentifiedText: text,
      mapping: {},
      entities: [],
      audit: {
        ...buildPassthroughAudit(true),
        operator: 'token_replace',
      },
      sealedMapping: null,
    };
  }

  try {
    const rawResults = await analyzeText(text, {
      language: config.language,
      scoreThreshold: config.minScore,
      adHocRecognizers: MEDICAL_AD_HOC_RECOGNIZERS,
    });
    const filtered = filterAnalyzerResults(text, rawResults, config.minScore);

    if (filtered.length === 0) {
      return {
        deidentifiedText: text,
        mapping: {},
        entities: [],
        audit: {
          enabled: true,
          operator: 'token_replace',
          language: config.language,
          minScore: config.minScore,
          entityCount: 0,
          entities: [],
          timestamp: new Date().toISOString(),
        },
        sealedMapping: null,
      };
    }

    const tokenized = buildTokenizedText(text, filtered);
    const audit: DeidentificationAudit = {
      enabled: true,
      operator: 'token_replace',
      language: config.language,
      minScore: config.minScore,
      entityCount: filtered.length,
      entities: summarizeEntities(filtered),
      timestamp: new Date().toISOString(),
    };

    logger.info('De-identified text before LLM analysis', {
      entityCount: audit.entityCount,
      entityTypes: audit.entities.map((entity) => entity.entityType),
    });

    incrementPhiEntitiesDetected(audit.entityCount, { operator: 'token_replace' });

    return {
      deidentifiedText: tokenized.text,
      mapping: tokenized.mapping,
      entities: filtered,
      audit,
      sealedMapping: sealMappingIfConfigured(tokenized.mapping),
    };
  } catch (error) {
    const message =
      error instanceof PresidioClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unknown Presidio failure';

    logger.error('De-identification failed closed; analysis halted', {
      error: message,
    });

    incrementFailClosed({ reason: 'presidio_unavailable' });

    throw new Error(
      `De-identification unavailable; analysis halted to avoid sending raw PHI to the model. ${message}`
    );
  }
};

export const aggregateDeidentificationAudits = (
  audits: DeidentificationAudit[]
): Record<string, unknown> | null => {
  if (audits.length === 0) {
    return null;
  }

  const enabled = audits.some((audit) => audit.enabled);
  const byType = new Map<string, DeidentificationEntitySummary>();

  for (const audit of audits) {
    for (const entity of audit.entities) {
      const existing = byType.get(entity.entityType);
      if (!existing) {
        byType.set(entity.entityType, { ...entity });
        continue;
      }

      existing.count += entity.count;
      existing.maxScore = Math.max(existing.maxScore, entity.maxScore);
      existing.minScore = Math.min(existing.minScore, entity.minScore);
    }
  }

  return {
    enabled,
    operator: enabled ? 'token_replace' : 'passthrough',
    entityCount: Array.from(byType.values()).reduce((sum, entity) => sum + entity.count, 0),
    entities: Array.from(byType.values()).sort((a, b) => a.entityType.localeCompare(b.entityType)),
    reportCount: audits.length,
  };
};

/** Detect whether seeded PHI values appear in text that will leave the trust boundary. */
export const findLeakedPhiValues = (text: string, seededValues: string[]): string[] => {
  const leaks: string[] = [];
  for (const value of seededValues) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (text.toLowerCase().includes(trimmed.toLowerCase())) {
      leaks.push(trimmed);
    }
  }
  return leaks;
};
