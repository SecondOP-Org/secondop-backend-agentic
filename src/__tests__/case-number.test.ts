import { generateCaseNumber, toPatientFacingCaseRef } from '../utils/caseNumber';

describe('generateCaseNumber', () => {
  it('returns a short SO-prefixed reference', () => {
    const value = generateCaseNumber();
    expect(value).toMatch(/^SO-[A-F0-9]{8}$/);
  });
});

describe('toPatientFacingCaseRef', () => {
  it('shortens a bare UUID', () => {
    expect(toPatientFacingCaseRef('43f96bb4-a058-4da6-b319-0a6bf6bc3b34')).toBe('SO-43F96BB4');
  });

  it('shortens SO- + full UUID legacy case numbers', () => {
    expect(toPatientFacingCaseRef('SO-43f96bb4-a058-4da6-b319-0a6bf6bc3b34')).toBe('SO-43F96BB4');
  });

  it('preserves already-short SO-XXXXXXXX refs', () => {
    expect(toPatientFacingCaseRef('SO-a1b2c3d4')).toBe('SO-A1B2C3D4');
  });

  it('preserves human seed/demo style refs', () => {
    expect(toPatientFacingCaseRef('SO-SEED-1784224748')).toBe('SO-SEED-1784224748');
    expect(toPatientFacingCaseRef('SO-DEMO-CARDIO-001')).toBe('SO-DEMO-CARDIO-001');
    expect(toPatientFacingCaseRef('SO-1001')).toBe('SO-1001');
  });

  it('falls back to case id when case_number is empty', () => {
    expect(toPatientFacingCaseRef('', '43f96bb4-a058-4da6-b319-0a6bf6bc3b34')).toBe('SO-43F96BB4');
  });
});
