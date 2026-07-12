import { generateCaseNumber } from '../utils/caseNumber';

describe('generateCaseNumber', () => {
  it('returns a short SO-prefixed reference', () => {
    const value = generateCaseNumber();
    expect(value).toMatch(/^SO-[A-F0-9]{8}$/);
  });
});
