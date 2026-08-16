import { IntakeValidationAgent } from '../agents/case-analysis/intake-validation.agent';
import { ReportExtractionAgent } from '../agents/case-analysis/report-extraction.agent';
import { validateIntakeTool } from '../agentic/tools/intake.tool';
import { extractReportsTool } from '../agentic/tools/extract.tool';
import { AgentContext } from '../agents/core/agent.types';
import { AgenticLoopState, AgenticRuntimeContext } from '../agentic/core/types';
import { mapGoldCaseToFixtures, flattenGoldReferenceAsOutput } from '../evals/gold/mapGoldCase';
import { loadGoldCases } from '../evals/gold';
import { runGoldEvalHarness, scoreGoldCaseAgainstOutput } from '../evals/goldEvalHarness';
import { query } from '../database/connection';
import { extractCaseReports } from '../services/reportExtraction.service';
import { runCaseAnalysis } from '../agents/case-analysis/runCaseAnalysis';
import { runAgenticCaseAnalysis } from '../agentic/orchestration/runAgenticCaseAnalysis';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../services/reportExtraction.service', () => ({
  extractCaseReports: jest.fn(),
}));

jest.mock('../agents/case-analysis/runCaseAnalysis', () => ({
  runCaseAnalysis: jest.fn(),
}));

jest.mock('../agentic/orchestration/runAgenticCaseAnalysis', () => ({
  runAgenticCaseAnalysis: jest.fn(),
}));

const mockedRunCaseAnalysis = runCaseAnalysis as jest.MockedFunction<typeof runCaseAnalysis>;
const mockedRunAgenticCaseAnalysis = runAgenticCaseAnalysis as jest.MockedFunction<
  typeof runAgenticCaseAnalysis
>;

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExtract = extractCaseReports as jest.MockedFunction<typeof extractCaseReports>;

const buildAgentContext = (fixtures?: AgentContext['fixtures'], persist = false): AgentContext => ({
  caseId: 'case-x',
  runId: 'run-x',
  maxCharsPerFile: 1000,
  maxTotalChars: 5000,
  fixtures,
  persist,
  emitEvent: jest.fn().mockResolvedValue(undefined),
  runWithinActiveStep: async (fn) => fn(),
});

describe('gold eval fixtures + harness (SEC-205 phase 2/3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('baseline intake/extract agents use fixtures and skip DB/disk', async () => {
    const [goldCase] = loadGoldCases({ subset: 'smoke' }).filter((c) => c.id === 'cardio-001');
    const fixtures = mapGoldCaseToFixtures(goldCase);
    const context = buildAgentContext(fixtures, false);

    const intakeAgent = new IntakeValidationAgent();
    const extractAgent = new ReportExtractionAgent();

    const afterIntake = await intakeAgent.run({ caseId: 'case-x' }, context);
    expect(afterIntake.intake).toEqual(fixtures.intake);
    expect(mockedQuery).not.toHaveBeenCalled();

    const afterExtract = await extractAgent.run(afterIntake, context);
    expect(afterExtract.reports).toEqual(fixtures.reports);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('agentic intake/extract tools use fixtures and skip DB/disk', async () => {
    const [goldCase] = loadGoldCases({ subset: 'smoke' }).filter((c) => c.id === 'cardio-001');
    const fixtures = mapGoldCaseToFixtures(goldCase);
    const context: AgenticRuntimeContext = {
      caseId: 'case-x',
      runId: 'run-x',
      mode: 'agentic',
      maxCharsPerFile: 1000,
      maxTotalChars: 5000,
      policy: {
        allowedActions: [],
        maxSteps: 1,
        maxRefinements: 0,
        maxWallClockMs: 120000,
        maxTotalTokens: 40000,
        maxEstimatedCostUsd: null,
      },
      model: 'test',
      fixtures,
      persist: false,
    };
    const state: AgenticLoopState = {
      caseId: 'case-x',
      runId: 'run-x',
      mode: 'agentic',
      stepCount: 0,
      refinementCount: 0,
      criticFeedback: null,
      intake: null,
      reports: [],
      analysis: null,
      observations: [],
      finalArtifact: null,
      criticScore: null,
    };

    const afterIntake = await validateIntakeTool(context, state);
    expect(afterIntake.intake).toEqual(fixtures.intake);
    expect(mockedQuery).not.toHaveBeenCalled();

    const afterExtract = await extractReportsTool(context, afterIntake);
    expect(afterExtract.reports).toEqual(fixtures.reports);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('score-only harness passes when references satisfy their own safety assertions', async () => {
    const report = await runGoldEvalHarness({
      engines: 'both',
      subset: 'smoke',
      goldSetVersion: 'gold-v0-samples',
      scoreOnly: true,
      skipJudge: true,
    });

    expect(report.mode).toBe('score-only');
    expect(report.results.length).toBe(6); // 3 cases × 2 engines
    expect(report.gatePassed).toBe(true);
    expect(report.baseline?.safetyPassRate).toBe(1);
    expect(report.agentic?.safetyPassRate).toBe(1);
  });

  it('scores a failing output as safety failure', async () => {
    const [goldCase] = loadGoldCases({ subset: 'smoke' }).filter((c) => c.id === 'cardio-001');
    const result = await scoreGoldCaseAgainstOutput({
      goldCase,
      engine: 'baseline',
      outputText: 'No mention of the critical concept.',
      skipJudge: true,
    });
    expect(result.safetyPassed).toBe(false);
    expect(result.safetyFailures.length).toBeGreaterThan(0);
  });

  it('maps gold reference text for score-only self-checks', () => {
    const [goldCase] = loadGoldCases({ subset: 'smoke' }).filter((c) => c.id === 'cardio-001');
    const text = flattenGoldReferenceAsOutput(goldCase);
    expect(text.toLowerCase()).toContain('anticoagulation');
  });

  it('records engine errors as failed cases and still returns a scorecard', async () => {
    mockedRunCaseAnalysis.mockRejectedValue(
      new Error('Required clinician-review disclaimer is missing.')
    );
    mockedRunAgenticCaseAnalysis.mockRejectedValue(new Error('Query error ECONNREFUSED'));

    const report = await runGoldEvalHarness({
      engines: 'both',
      subset: 'smoke',
      goldSetVersion: 'gold-v0-samples',
      skipJudge: true,
    });

    expect(report.mode).toBe('live');
    expect(report.results.length).toBe(6);
    expect(report.results.every((result) => result.safetyPassed === false)).toBe(true);
    expect(report.results.some((result) => result.safetyFailures[0]?.includes('disclaimer'))).toBe(
      true
    );
    expect(report.results.some((result) => result.safetyFailures[0]?.includes('ECONNREFUSED'))).toBe(
      true
    );
    expect(report.gatePassed).toBe(false);
    expect(report.baseline?.caseCount).toBe(3);
    expect(report.agentic?.caseCount).toBe(3);
  });
});
