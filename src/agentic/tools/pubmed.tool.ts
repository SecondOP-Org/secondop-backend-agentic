import logger from '../../utils/logger';
import { searchPubMed } from '../../services/grounding/pubmed.client';
import { Citation } from '../../services/grounding/types';
import { AgenticLoopState, AgenticRuntimeContext } from '../core/types';

/**
 * PubMed grounding tool — queries only normalized evidenceTerms (never raw PHI narrative).
 */
export const pubmedTool = async (
  _context: AgenticRuntimeContext,
  state: AgenticLoopState
): Promise<{ citations: Citation[] }> => {
  const terms = state.normalizedEntities?.evidenceTerms || [];
  try {
    const citations = await searchPubMed(terms, 5);
    logger.info('PubMed grounding tool completed', {
      termCount: terms.length,
      citationCount: citations.length,
    });
    return { citations };
  } catch (error) {
    logger.warn('pubmedTool failed (fail-soft)', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return { citations: [] };
  }
};
