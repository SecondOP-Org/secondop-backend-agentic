import {
  CaseAnalysisArtifact,
} from '../analysisArtifact.service';
import { Citation, CitationLink, TrialMatch } from './types';

/**
 * Attach API-sourced citations/trials to the analysis artifact.
 * Never invents PMIDs or NCT IDs — only merges provided API results.
 */
export const attachGroundingToArtifact = (
  artifact: CaseAnalysisArtifact,
  grounding: {
    citations?: Citation[];
    trialMatches?: TrialMatch[];
    citationLinks?: CitationLink[];
  }
): CaseAnalysisArtifact => {
  const citations = grounding.citations || [];
  const trialMatches = grounding.trialMatches || [];

  // Default: link citations to follow-up discussion when present.
  const citationLinks =
    grounding.citationLinks && grounding.citationLinks.length > 0
      ? grounding.citationLinks
      : citations.length > 0
        ? [
            {
              section: 'follow_up_discussion_points',
              citationIds: citations.map((c) => c.id),
            },
          ]
        : [];

  return {
    ...artifact,
    citations,
    trialMatches,
    citation_links: citationLinks,
  };
};
