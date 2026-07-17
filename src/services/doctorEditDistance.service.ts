import { query } from '../database/connection';
import { getLatestAnalysisRun } from './analysisRun.service';
import { startPhoenixSpan } from '../observability/phoenix.service';
import logger from '../utils/logger';

/** Collapse whitespace and lowercase for stable edit-distance comparisons. */
export const normalizeForEditDistance = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Classic Levenshtein distance (insert/delete/substitute cost 1). */
export const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  const prev = new Array<number>(right.length + 1);
  const curr = new Array<number>(right.length + 1);

  for (let j = 0; j <= right.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[right.length];
};

/**
 * Normalized edit distance in [0, 1]: distance / max(len(a), len(b), 1).
 * 0 = identical after normalize; 1 = fully rewritten (or empty vs non-empty).
 */
export const normalizedEditDistance = (draft: string, finalText: string): number => {
  const left = normalizeForEditDistance(draft);
  const right = normalizeForEditDistance(finalText);
  const denom = Math.max(left.length, right.length, 1);
  return levenshteinDistance(left, right) / denom;
};

export const computeAiDraftEditRatio = (
  questionAnswers: Array<{ questionId: string; answer: string }>,
  aiDraftBaselines: Record<string, string> | null | undefined
): number | null => {
  if (!aiDraftBaselines || typeof aiDraftBaselines !== 'object') {
    return null;
  }

  const ratios: number[] = [];
  for (const item of questionAnswers) {
    const baseline = aiDraftBaselines[item.questionId];
    if (typeof baseline !== 'string' || !baseline.trim()) {
      continue;
    }
    ratios.push(normalizedEditDistance(baseline, item.answer || ''));
  }

  if (ratios.length === 0) {
    return null;
  }

  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  return Math.round(mean * 10000) / 10000;
};

export const resolveAiDraftBaselines = (
  fromPayload: Record<string, string> | undefined,
  fromStoredDraft: unknown
): Record<string, string> | null => {
  if (fromPayload && Object.keys(fromPayload).length > 0) {
    return fromPayload;
  }

  if (
    fromStoredDraft &&
    typeof fromStoredDraft === 'object' &&
    !Array.isArray(fromStoredDraft) &&
    'aiDraftBaselines' in fromStoredDraft
  ) {
    const raw = (fromStoredDraft as { aiDraftBaselines?: unknown }).aiDraftBaselines;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) {
          next[key] = value;
        }
      }
      return Object.keys(next).length > 0 ? next : null;
    }
  }

  return null;
};

/**
 * Persist mean edit ratio on the case and attach to the latest analysis run trace.
 */
export const recordAiDraftEditRatioOnSend = async (params: {
  caseId: string;
  questionAnswers: Array<{ questionId: string; answer: string }>;
  aiDraftBaselines?: Record<string, string>;
  storedDraft?: unknown;
}): Promise<number | null> => {
  const baselines = resolveAiDraftBaselines(params.aiDraftBaselines, params.storedDraft);
  const ratio = computeAiDraftEditRatio(params.questionAnswers, baselines);

  if (ratio == null) {
    return null;
  }

  await query(
    `UPDATE cases
     SET ai_draft_edit_ratio = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [params.caseId, ratio]
  );

  let runId: string | undefined;
  try {
    const latestRun = await getLatestAnalysisRun(params.caseId);
    runId = latestRun?.id;
  } catch (error) {
    logger.warn('Unable to load latest analysis run for edit-ratio span', {
      caseId: params.caseId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const span = startPhoenixSpan(
    'doctor.opinion.send',
    {
      caseId: params.caseId,
      ...(runId ? { runId } : {}),
      'eval.ai_draft_edit_ratio': ratio,
    },
    'CHAIN'
  );
  span.end('OK');

  return ratio;
};
