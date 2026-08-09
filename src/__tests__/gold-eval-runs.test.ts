import {
  buildCutoverChecklist,
  GoldEvalRunRow,
} from '../services/goldEvalRuns.service';

const baseRun = (overrides: Partial<GoldEvalRunRow>): GoldEvalRunRow => ({
  id: 'id',
  goldSetVersion: 'gold-v0-samples',
  engine: 'baseline',
  meanCorrectness: 0.8,
  safetyPassRate: 1,
  meanQuality: 0.9,
  caseCount: 3,
  gatePassed: true,
  gitSha: 'abc1234',
  judgeModel: 'gpt-4.1-mini',
  judgeRubricVersion: 'gold-judge-v1',
  runMode: 'live',
  createdAt: '2026-08-09T00:00:00.000Z',
  ...overrides,
});

describe('goldEvalRuns checklist (SEC-205)', () => {
  it('marks correctness and safety pass when agentic meets gates', () => {
    const checklist = buildCutoverChecklist([
      baseRun({
        id: 'a1',
        engine: 'agentic',
        meanCorrectness: 0.9,
        safetyPassRate: 1,
        createdAt: '2026-08-09T03:00:00.000Z',
      }),
      baseRun({
        id: 'b1',
        engine: 'baseline',
        meanCorrectness: 0.85,
        createdAt: '2026-08-09T03:00:00.000Z',
      }),
      baseRun({
        id: 'a0',
        engine: 'agentic',
        meanCorrectness: 0.88,
        createdAt: '2026-08-09T02:00:00.000Z',
      }),
      baseRun({
        id: 'a-1',
        engine: 'agentic',
        meanCorrectness: 0.87,
        createdAt: '2026-08-09T01:00:00.000Z',
      }),
    ]);

    expect(checklist.items.find((i) => i.id === 'gold_correctness')?.status).toBe('pass');
    expect(checklist.items.find((i) => i.id === 'gold_safety')?.status).toBe('pass');
    expect(checklist.items.find((i) => i.id === 'gold_trend')?.status).toBe('pass');
    expect(checklist.items.find((i) => i.id === 'shadow_parity')?.status).toBe('unknown');
    expect(checklist.allGreen).toBe(false);
  });

  it('fails safety when agentic safetyPassRate < 1', () => {
    const checklist = buildCutoverChecklist([
      baseRun({ engine: 'agentic', safetyPassRate: 0.66, meanCorrectness: 0.9 }),
      baseRun({ engine: 'baseline', meanCorrectness: 0.8 }),
    ]);
    expect(checklist.items.find((i) => i.id === 'gold_safety')?.status).toBe('fail');
  });
});
