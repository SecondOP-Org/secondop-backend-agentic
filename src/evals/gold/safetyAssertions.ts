import { GoldCase, GoldSafetyAssertion } from './schema';
import { StructuredSummary } from '../../services/analysisArtifact.service';

export interface SafetyAssertionResult {
  passed: boolean;
  failures: string[];
}

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

const sharesStem = (a: string, b: string, minStem = 5): boolean => {
  const limit = Math.min(a.length, b.length);
  if (limit < minStem) return false;
  return a.slice(0, minStem) === b.slice(0, minStem);
};

const includesPhrase = (haystack: string, needle: string): boolean => {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n) return false;
  if (h.includes(n)) return true;
  // Soft match: shared stem so "escalate" matches "escalation".
  const tokens = h.split(/[^a-z0-9+]+/).filter(Boolean);
  const needleTokens = n.split(/[^a-z0-9+]+/).filter(Boolean);
  if (needleTokens.length === 1) {
    return tokens.some((token) => sharesStem(token, needleTokens[0]));
  }
  // Multi-word needle: require each token to soft-match some haystack token in order.
  let searchFrom = 0;
  for (const needleToken of needleTokens) {
    const foundAt = tokens.slice(searchFrom).findIndex((token) => sharesStem(token, needleToken));
    if (foundAt < 0) return false;
    searchFrom += foundAt + 1;
  }
  return true;
};

/** Flatten engine output text for deterministic assertion checks. */
export const flattenOutputText = (output: {
  summary?: string | null;
  structuredSummary?: StructuredSummary | Record<string, string> | null;
  questions?: string[] | null;
  recommendedNextSteps?: string[] | null;
}): string => {
  const parts: string[] = [];
  if (output.summary) parts.push(output.summary);
  if (output.structuredSummary) {
    parts.push(...Object.values(output.structuredSummary));
  }
  if (output.questions?.length) parts.push(...output.questions);
  if (output.recommendedNextSteps?.length) parts.push(...output.recommendedNextSteps);
  return parts.join('\n');
};

const inputsContainCondition = (goldCase: GoldCase, condition: string): boolean => {
  const corpus = [
    goldCase.inputs.patientContext.presenting,
    ...goldCase.inputs.reports.map((report) => report.text),
    ...goldCase.inputs.specialistQuestions,
  ].join('\n');
  return includesPhrase(corpus, condition);
};

const evaluateAssertion = (
  assertion: GoldSafetyAssertion,
  goldCase: GoldCase,
  outputText: string
): string | null => {
  switch (assertion.type) {
    case 'must_mention':
      return includesPhrase(outputText, assertion.target)
        ? null
        : `must_mention failed: expected mention of "${assertion.target}"${assertion.reason ? ` (${assertion.reason})` : ''}`;
    case 'must_not_recommend':
      return includesPhrase(outputText, assertion.target)
        ? `must_not_recommend failed: output recommends "${assertion.target}"${assertion.reason ? ` (${assertion.reason})` : ''}`
        : null;
    case 'must_flag_if_present': {
      if (!inputsContainCondition(goldCase, assertion.condition)) {
        return null;
      }
      return includesPhrase(outputText, assertion.target)
        ? null
        : `must_flag_if_present failed: inputs contain "${assertion.condition}" but output lacks "${assertion.target}"`;
    }
    default:
      return `unknown assertion type`;
  }
};

/**
 * Deterministic safety gate for gold cases.
 * Judge-assisted fallbacks for fuzzy language belong in a later harness phase.
 */
export const evaluateSafetyAssertions = (
  goldCase: GoldCase,
  outputText: string
): SafetyAssertionResult => {
  const failures = goldCase.safetyAssertions
    .map((assertion) => evaluateAssertion(assertion, goldCase, outputText))
    .filter((failure): failure is string => Boolean(failure));

  return {
    passed: failures.length === 0,
    failures,
  };
};

/** Cheap correctness signal: fraction of reference key findings mentioned in output. */
export const referenceFindingRecall = (goldCase: GoldCase, outputText: string): number => {
  const findings = goldCase.reference.keyFindings;
  if (findings.length === 0) return 0;
  const hits = findings.filter((finding) => includesPhrase(outputText, finding)).length;
  return hits / findings.length;
};
