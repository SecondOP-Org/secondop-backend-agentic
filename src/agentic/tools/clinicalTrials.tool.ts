import { isClinicalTrialsSpecialtyAllowed } from '../../config/grounding';
import logger from '../../utils/logger';
import { searchTrials } from '../../services/grounding/clinicalTrials.client';
import { TrialMatch } from '../../services/grounding/types';
import { AgenticLoopState, AgenticRuntimeContext } from '../core/types';

/**
 * ClinicalTrials.gov tool — specialty-gated; inputs from normalized conditions only.
 */
export const clinicalTrialsTool = async (
  _context: AgenticRuntimeContext,
  state: AgenticLoopState
): Promise<{ trialMatches: TrialMatch[] }> => {
  const specialty = state.intake?.specialtyContext || '';
  if (!isClinicalTrialsSpecialtyAllowed(specialty)) {
    logger.info('clinicalTrialsTool skipped — specialty not on allowlist', {
      specialtyNormalized: specialty.trim().toLowerCase().replace(/[\s_]+/g, '-').slice(0, 64),
    });
    return { trialMatches: [] };
  }

  const condition =
    state.normalizedEntities?.conditions?.[0]?.raw ||
    state.normalizedEntities?.evidenceTerms?.[0] ||
    '';

  if (!condition) {
    return { trialMatches: [] };
  }

  try {
    const trialMatches = await searchTrials({ condition, status: 'RECRUITING' });
    logger.info('ClinicalTrials grounding tool completed', {
      trialCount: trialMatches.length,
    });
    return { trialMatches };
  } catch (error) {
    logger.warn('clinicalTrialsTool failed (fail-soft)', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return { trialMatches: [] };
  }
};
