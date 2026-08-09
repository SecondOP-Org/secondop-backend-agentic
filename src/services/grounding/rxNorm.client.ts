import { GROUNDING_CACHE_TTL_MS } from '../../config/grounding';
import logger from '../../utils/logger';
import { groundingFetch } from './http';
import { TtlCache } from './ttlCache';

const RXNORM_BASE = 'https://rxnav.nlm.nih.gov/REST';
const cache = new TtlCache<{ rxcui: string; normalizedName: string } | null>(GROUNDING_CACHE_TTL_MS);

export interface RxNormResolveResult {
  rxcui: string;
  normalizedName: string;
}

/** Test helper: clear in-memory cache between tests. */
export const clearRxNormCacheForTests = (): void => {
  cache.clear();
};

/**
 * Resolve a drug name to RxCUI via RxNav approximate match.
 * Fail-soft: returns null on no match, timeout, or error.
 */
export const resolveDrug = async (name: string): Promise<RxNormResolveResult | null> => {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    return null;
  }

  const cacheKey = trimmed.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const url = `${RXNORM_BASE}/rxcui.json?name=${encodeURIComponent(trimmed)}&search=2`;
    const response = await groundingFetch(url);
    if (!response.ok) {
      logger.warn('RxNorm resolve non-OK (fail-soft)', { status: response.status });
      cache.set(cacheKey, null);
      return null;
    }

    const body = (await response.json()) as {
      idGroup?: { rxnormId?: string[]; name?: string };
    };
    const rxcui = body.idGroup?.rxnormId?.[0];
    if (!rxcui) {
      cache.set(cacheKey, null);
      return null;
    }

    const result: RxNormResolveResult = {
      rxcui: String(rxcui),
      normalizedName: body.idGroup?.name?.trim() || trimmed,
    };
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    logger.warn('RxNorm resolve failed (fail-soft)', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
};
