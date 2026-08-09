import { GROUNDING_CACHE_TTL_MS } from '../../config/grounding';
import logger from '../../utils/logger';
import { groundingFetch } from './http';
import { TrialMatch } from './types';
import { TtlCache } from './ttlCache';

const CT_BASE = 'https://clinicaltrials.gov/api/v2';
const cache = new TtlCache<TrialMatch[]>(GROUNDING_CACHE_TTL_MS);

export const clearClinicalTrialsCacheForTests = (): void => {
  cache.clear();
};

const summarizeEligibility = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }
  // Never claim patient eligibility — frame as potentially relevant only.
  const clipped = raw.replace(/\s+/g, ' ').trim().slice(0, 240);
  return clipped ? `Potentially relevant trial criteria excerpt: ${clipped}` : undefined;
};

/**
 * Search ClinicalTrials.gov API v2. Fail-soft: returns [] on any error/timeout.
 */
export const searchTrials = async (q: {
  condition: string;
  status?: 'RECRUITING';
}): Promise<TrialMatch[]> => {
  const condition = (q.condition || '').trim();
  if (!condition) {
    return [];
  }

  const status = q.status || 'RECRUITING';
  const cacheKey = `${condition.toLowerCase()}::${status}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const params = new URLSearchParams({
      'query.cond': condition,
      'filter.overallStatus': status,
      pageSize: '5',
      fields: 'NCTId,BriefTitle,Phase,OverallStatus,EligibilityCriteria',
    });

    const response = await groundingFetch(`${CT_BASE}/studies?${params.toString()}`);
    if (!response.ok) {
      logger.warn('ClinicalTrials search non-OK (fail-soft)', { status: response.status });
      return [];
    }

    const body = (await response.json()) as {
      studies?: Array<{
        protocolSection?: {
          identificationModule?: { nctId?: string; briefTitle?: string };
          statusModule?: { overallStatus?: string };
          designModule?: { phases?: string[] };
          eligibilityModule?: { eligibilityCriteria?: string };
        };
      }>;
    };

    const matches: TrialMatch[] = [];
    for (const study of body.studies || []) {
      const idMod = study.protocolSection?.identificationModule;
      const nctId = idMod?.nctId?.trim();
      const title = idMod?.briefTitle?.trim();
      if (!nctId || !title) {
        continue;
      }

      const phases = study.protocolSection?.designModule?.phases || [];
      matches.push({
        id: `nct:${nctId}`,
        source: 'clinicaltrials',
        nctId,
        title,
        phase: phases.length ? phases.join(', ') : undefined,
        status: study.protocolSection?.statusModule?.overallStatus || status,
        url: `https://clinicaltrials.gov/study/${nctId}`,
        eligibilitySummary: summarizeEligibility(
          study.protocolSection?.eligibilityModule?.eligibilityCriteria
        ),
      });
    }

    cache.set(cacheKey, matches);
    return matches;
  } catch (error) {
    logger.warn('ClinicalTrials search failed (fail-soft)', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return [];
  }
};
