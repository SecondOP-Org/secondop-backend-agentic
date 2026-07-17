import { runAgenticRuntime } from '../agentic/core/runtime';

jest.mock('../agentic/observability/eventEmitter', () => ({
  emitAgenticStepEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/caseAnalysisRunArtifact.service', () => {
  const actual = jest.requireActual('../services/caseAnalysisRunArtifact.service');
  return {
    ...actual,
    insertCaseAnalysisArtifact: jest.fn().mockResolvedValue(undefined),
  };
});
import { AgenticError, AgenticLoopState } from '../agentic/core/types';
import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';

describe('Agentic runtime policies', () => {
  const baseState: AgenticLoopState = {
    caseId: 'case-1',
    runId: 'run-1',
    mode: 'shadow',
    stepCount: 0,
    refinementCount: 0,
    criticFeedback: null,
    intake: null,
    reports: [],
    analysis: {
      summary: 'Chief Concern: possible ACS with uncertain etiology',
      topQuestions: [
        'What immediate diagnostics are recommended?',
        'Could this represent unstable angina despite normal ECG?',
        'Which follow-up timeline is most appropriate?',
      ],
      artifact: buildCaseAnalysisArtifact({
        structuredSummary: {
          chief_concern: 'possible ACS with uncertain etiology',
          key_report_findings: 'Normal ECG does not exclude ischemia',
          red_flags_to_discuss: 'Persistent chest pain',
          follow_up_discussion_points: 'Serial biomarkers',
          limitations_caveats: 'Requires clinician review',
        },
        specialistQuestions: [
          'What immediate diagnostics are recommended?',
          'Could this represent unstable angina despite normal ECG?',
          'Which follow-up timeline is most appropriate?',
        ],
        model: 'gpt-4.1-mini',
      }),
      artifactDeidentified: buildCaseAnalysisArtifact({
        structuredSummary: {
          chief_concern: 'possible ACS with uncertain etiology',
          key_report_findings: 'Normal ECG does not exclude ischemia',
          red_flags_to_discuss: 'Persistent chest pain',
          follow_up_discussion_points: 'Serial biomarkers',
          limitations_caveats: 'Requires clinician review',
        },
        specialistQuestions: [
          'What immediate diagnostics are recommended?',
          'Could this represent unstable angina despite normal ECG?',
          'Which follow-up timeline is most appropriate?',
        ],
        model: 'gpt-4.1-mini',
      }),
      model: 'gpt-4.1-mini',
    },
    observations: ['Chief Concern: possible ACS with uncertain etiology'],
    finalArtifact: null,
    criticScore: null,
  };

  const noopTools = {
    VALIDATE_INTAKE: async (_context: any, state: AgenticLoopState) => state,
    EXTRACT_REPORTS: async (_context: any, state: AgenticLoopState) => state,
    SYNTHESIZE_SUMMARY: async (_context: any, state: AgenticLoopState) => state,
    GUARD_QUESTIONS: async (_context: any, state: AgenticLoopState) => state,
  };

  it('rejects disallowed planner action', async () => {
    const planner = {
      planNextAction: jest.fn().mockResolvedValue({ action: 'HACK', rationale: 'bad action' }),
    } as any;

    await expect(
      runAgenticRuntime({
        context: {
          caseId: 'case-1',
          runId: 'run-1',
          mode: 'shadow',
          maxCharsPerFile: 12000,
          maxTotalChars: 30000,
          model: 'gpt-4.1-mini',
          policy: {
            allowedActions: ['VALIDATE_INTAKE', 'EXTRACT_REPORTS', 'SYNTHESIZE_SUMMARY', 'GUARD_QUESTIONS', 'FINALIZE'],
            maxSteps: 8,
            maxRefinements: 1,
          },
        },
        initialState: baseState,
        planner,
        critic: { evaluate: jest.fn() } as any,
        finalizer: { finalize: jest.fn() } as any,
        tools: noopTools,
      })
    ).rejects.toEqual(expect.objectContaining<Partial<AgenticError>>({ code: 'policy_error' }));
  });

  it('enforces refinement budget', async () => {
    const planner = {
      planNextAction: jest.fn().mockResolvedValue({ action: 'FINALIZE', rationale: 'Finalize now' }),
    } as any;

    const critic = {
      evaluate: jest.fn().mockResolvedValue({
        passed: false,
        needsRefinement: true,
        score: 25,
        reasons: ['Missing caveat language'],
        checks: {
          hasThreeQuestions: true,
          hasUniqueQuestions: true,
          hasObservations: true,
          hasCaveatLanguage: false,
        },
      }),
    } as any;

    const finalizer = {
      finalize: jest.fn().mockReturnValue({
        summary: baseState.analysis!.summary,
        questions: baseState.analysis!.topQuestions,
        observations: baseState.observations,
        artifact: baseState.analysis!.artifact,
        model: 'gpt-4.1-mini',
      }),
    } as any;

    await expect(
      runAgenticRuntime({
        context: {
          caseId: 'case-1',
          runId: 'run-1',
          mode: 'shadow',
          maxCharsPerFile: 12000,
          maxTotalChars: 30000,
          model: 'gpt-4.1-mini',
          policy: {
            allowedActions: ['VALIDATE_INTAKE', 'EXTRACT_REPORTS', 'SYNTHESIZE_SUMMARY', 'GUARD_QUESTIONS', 'FINALIZE'],
            maxSteps: 8,
            maxRefinements: 0,
          },
        },
        initialState: baseState,
        planner,
        critic,
        finalizer,
        tools: noopTools,
      })
    ).rejects.toEqual(expect.objectContaining<Partial<AgenticError>>({ code: 'policy_error' }));
  });
});
