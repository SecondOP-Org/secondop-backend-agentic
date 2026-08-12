import {
  CASE_TITLE_MAX_CHARS,
  fallbackTitleFromDescription,
  sanitizeCaseTitle,
} from '../services/caseTitleSuggest.service';

describe('caseTitleSuggest (SEC-218)', () => {
  it('sanitizes quotes and clamps length', () => {
    expect(sanitizeCaseTitle('"Chest pain workup"')).toBe('Chest pain workup');
    const long = 'a'.repeat(CASE_TITLE_MAX_CHARS + 20);
    expect(sanitizeCaseTitle(long).length).toBeLessThanOrEqual(CASE_TITLE_MAX_CHARS);
  });

  it('builds a fallback title from the first sentence', () => {
    expect(
      fallbackTitleFromDescription(
        'I want a second look at my MRI from last month. Also confused about meds.'
      )
    ).toBe('I want a second look at my MRI from last month');
  });

  it('returns Draft second opinion for empty input', () => {
    expect(fallbackTitleFromDescription('   ')).toBe('Draft second opinion');
  });
});
