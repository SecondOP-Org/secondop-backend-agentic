import { GROUNDING_CACHE_TTL_MS } from '../../config/grounding';
import logger from '../../utils/logger';
import { groundingFetch, sleep } from './http';
import { Citation } from './types';
import { TtlCache } from './ttlCache';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const cache = new TtlCache<Citation[]>(GROUNDING_CACHE_TTL_MS);

/** Serialize NCBI calls (~3 req/s without key). */
let lastNcbiCallAt = 0;
const NCBI_MIN_INTERVAL_MS = () => (process.env.NCBI_API_KEY?.trim() ? 110 : 350);

export const clearPubMedCacheForTests = (): void => {
  cache.clear();
  lastNcbiCallAt = 0;
};

const withNcbiThrottle = async <T>(fn: () => Promise<T>): Promise<T> => {
  const elapsed = Date.now() - lastNcbiCallAt;
  const wait = NCBI_MIN_INTERVAL_MS() - elapsed;
  if (wait > 0) {
    await sleep(wait);
  }
  lastNcbiCallAt = Date.now();
  return fn();
};

const appendApiKey = (params: URLSearchParams): void => {
  const key = process.env.NCBI_API_KEY?.trim();
  if (key) {
    params.set('api_key', key);
  }
};

const parseYear = (pubdate: unknown): number => {
  if (typeof pubdate !== 'string' || !pubdate.trim()) {
    return 0;
  }
  const match = pubdate.match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
};

/**
 * Search PubMed via NCBI E-utilities. Returns only API-sourced citations (never LLM-invented).
 * Fail-soft: returns [] on any error/timeout.
 */
export const searchPubMed = async (
  terms: string[],
  maxResults = 5
): Promise<Citation[]> => {
  const cleaned = (terms || [])
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (cleaned.length === 0) {
    return [];
  }

  const cacheKey = `${cleaned.join('|').toLowerCase()}::${maxResults}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const searchParams = new URLSearchParams({
      db: 'pubmed',
      retmode: 'json',
      retmax: String(Math.max(1, Math.min(maxResults, 10))),
      term: cleaned.join(' AND '),
    });
    appendApiKey(searchParams);

    const searchResponse = await withNcbiThrottle(() =>
      groundingFetch(`${EUTILS_BASE}/esearch.fcgi?${searchParams.toString()}`)
    );
    if (!searchResponse.ok) {
      logger.warn('PubMed esearch non-OK (fail-soft)', { status: searchResponse.status });
      return [];
    }

    const searchBody = (await searchResponse.json()) as {
      esearchresult?: { idlist?: string[] };
    };
    const pmids = (searchBody.esearchresult?.idlist || []).filter(Boolean);
    if (pmids.length === 0) {
      cache.set(cacheKey, []);
      return [];
    }

    const summaryParams = new URLSearchParams({
      db: 'pubmed',
      retmode: 'json',
      id: pmids.join(','),
    });
    appendApiKey(summaryParams);

    const summaryResponse = await withNcbiThrottle(() =>
      groundingFetch(`${EUTILS_BASE}/esummary.fcgi?${summaryParams.toString()}`)
    );
    if (!summaryResponse.ok) {
      logger.warn('PubMed esummary non-OK (fail-soft)', { status: summaryResponse.status });
      return [];
    }

    const summaryBody = (await summaryResponse.json()) as {
      result?: Record<string, unknown> & { uids?: string[] };
    };
    const result = summaryBody.result || {};
    const citations: Citation[] = [];

    for (const pmid of pmids) {
      const entry = result[pmid] as
        | {
            title?: string;
            fulljournalname?: string;
            source?: string;
            pubdate?: string;
          }
        | undefined;
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const title = (entry.title || '').trim();
      if (!title) {
        continue;
      }

      citations.push({
        id: `pmid:${pmid}`,
        source: 'pubmed',
        pmid: String(pmid),
        title,
        journal: (entry.fulljournalname || entry.source || '').trim() || 'Unknown journal',
        year: parseYear(entry.pubdate),
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      });
    }

    cache.set(cacheKey, citations);
    return citations;
  } catch (error) {
    logger.warn('PubMed search failed (fail-soft)', {
      message: error instanceof Error ? error.message : 'unknown',
      termCount: cleaned.length,
    });
    return [];
  }
};
