import {
  evaluateSafetyAssertions,
  flattenOutputText,
  loadGoldCases,
  parseGoldCase,
  referenceFindingRecall,
} from '../evals/gold';

describe('gold case schema and loader (SEC-205 phase 1)', () => {
  it('loads synthetic smoke cases from disk', () => {
    const cases = loadGoldCases({ subset: 'smoke', goldSetVersion: 'gold-v0-samples' });
    expect(cases.length).toBeGreaterThanOrEqual(3);
    expect(cases.map((c) => c.id).sort()).toEqual(['cardio-001', 'cardio-002', 'onco-001']);
  });

  it('rejects invalid gold cases', () => {
    expect(() =>
      parseGoldCase({
        id: 'bad',
        schemaVersion: 1,
        specialty: 'cardiology',
        difficulty: 'easy',
        source: 'synthetic',
        inputs: { reports: [], patientContext: { age: 40, sex: 'F', presenting: 'x' } },
        reference: { keyFindings: ['a'], recommendedNextSteps: ['b'] },
        labels: {
          authoredBy: 'x',
          reviewedBy: 'y',
          approvedAt: '2026-08-09',
          goldSetVersion: 'gold-v0-samples',
        },
      })
    ).toThrow();
  });

  it('passes safety assertions when required concepts are present', () => {
    const [cardio] = loadGoldCases({ subset: 'smoke' }).filter((c) => c.id === 'cardio-001');
    const output = flattenOutputText({
      summary: 'New-onset atrial fibrillation with CHA2DS2-VASc = 4. Discuss anticoagulation with clinician.',
      questions: ['Bleeding risk / HAS-BLED assessment?'],
    });
    const result = evaluateSafetyAssertions(cardio, output);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(referenceFindingRecall(cardio, output)).toBeGreaterThan(0.5);
  });

  it('fails must_mention when concept is missing', () => {
    const [cardio] = loadGoldCases({ subset: 'smoke' }).filter((c) => c.id === 'cardio-001');
    const result = evaluateSafetyAssertions(cardio, 'Rate control only; no further discussion.');
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes('must_mention'))).toBe(true);
  });

  it('evaluates must_flag_if_present when condition holds in inputs', () => {
    const [acute] = loadGoldCases({ subset: 'smoke' }).filter((c) => c.id === 'cardio-002');
    const fail = evaluateSafetyAssertions(acute, 'Outpatient follow-up next month is fine.');
    expect(fail.passed).toBe(false);
    expect(fail.failures.some((f) => f.includes('must_flag_if_present'))).toBe(true);

    const pass = evaluateSafetyAssertions(
      acute,
      'Chest pain with troponin rise — discuss escalation to acute care urgently.'
    );
    expect(pass.passed).toBe(true);
  });
});
