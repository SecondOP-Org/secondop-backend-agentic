import {
  computeAiDraftEditRatio,
  levenshteinDistance,
  normalizeForEditDistance,
  normalizedEditDistance,
  resolveAiDraftBaselines,
} from '../services/doctorEditDistance.service';

describe('doctorEditDistance.service', () => {
  describe('normalizeForEditDistance', () => {
    it('collapses whitespace and lowercases', () => {
      expect(normalizeForEditDistance('  Hello\nWorld  ')).toBe('hello world');
    });
  });

  describe('levenshteinDistance', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshteinDistance('abc', 'abc')).toBe(0);
    });

    it('handles empty strings', () => {
      expect(levenshteinDistance('', 'abc')).toBe(3);
      expect(levenshteinDistance('abc', '')).toBe(3);
      expect(levenshteinDistance('', '')).toBe(0);
    });

    it('counts substitutions', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    });
  });

  describe('normalizedEditDistance', () => {
    it('is 0 for identical text after normalize', () => {
      expect(normalizedEditDistance('Hello World', 'hello   world')).toBe(0);
    });

    it('is 1 for empty draft vs non-empty final', () => {
      expect(normalizedEditDistance('', 'rewrite')).toBe(1);
    });

    it('is between 0 and 1 for partial edits', () => {
      const ratio = normalizedEditDistance('hello world', 'hello earth');
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
    });
  });

  describe('computeAiDraftEditRatio', () => {
    it('returns null when no baselines', () => {
      expect(
        computeAiDraftEditRatio([{ questionId: 'q1', answer: 'a' }], null)
      ).toBeNull();
      expect(
        computeAiDraftEditRatio([{ questionId: 'q1', answer: 'a' }], {})
      ).toBeNull();
    });

    it('averages per-question ratios for inserted drafts only', () => {
      const ratio = computeAiDraftEditRatio(
        [
          { questionId: 'q1', answer: 'hello world' },
          { questionId: 'q2', answer: 'completely different' },
          { questionId: 'q3', answer: 'no baseline here' },
        ],
        {
          q1: 'hello world',
          q2: 'hello world',
        }
      );

      expect(ratio).not.toBeNull();
      expect(ratio!).toBeGreaterThan(0);
      expect(ratio!).toBeLessThanOrEqual(1);
      // q1 identical → 0; q2 rewritten → high; mean in (0, 1)
      expect(ratio!).toBe(normalizedEditDistance('hello world', 'completely different') / 2);
    });
  });

  describe('resolveAiDraftBaselines', () => {
    it('prefers payload over stored draft', () => {
      expect(
        resolveAiDraftBaselines(
          { q1: 'from payload' },
          { aiDraftBaselines: { q1: 'from draft' } }
        )
      ).toEqual({ q1: 'from payload' });
    });

    it('falls back to stored draft baselines', () => {
      expect(
        resolveAiDraftBaselines(undefined, {
          aiDraftBaselines: { q1: 'stored' },
        })
      ).toEqual({ q1: 'stored' });
    });
  });
});
