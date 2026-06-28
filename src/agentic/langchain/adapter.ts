import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { assertRefinementBudget, assertStepBudget } from '../core/policy';
import {
  AgenticAction,
  AgenticActionHistoryItem,
  AgenticError,
  AgenticLoopState,
  AgenticRuntimeContext,
} from '../core/types';
import { CriticAgent } from '../critic/critic.agent';
import { FinalizerAgent } from '../finalizer/finalizer.agent';
import { emitAgenticStepEvent } from '../observability/eventEmitter';
import { extractReportsTool } from '../tools/extract.tool';
import { guardQuestionsTool } from '../tools/question_guard.tool';
import { validateIntakeTool } from '../tools/intake.tool';
import { synthesizeSummaryTool } from '../tools/synthesize.tool';
import { getLangGraphCheckpointer } from './checkpointer';
import { buildLangGraphThreadId } from './threadId';
import { LangChainAgentAdapter, LangChainRunResult } from './types';

export const isLangChainRuntimeEnabled = (): boolean => {
  return (process.env.AGENTIC_RUNTIME || 'native').toLowerCase() === 'langchain';
};

interface LangGraphRuntimeState {
  state: AgenticLoopState;
  history: AgenticActionHistoryItem[];
  nextRoute: 'finalized' | 'refine';
}

type LangGraphNodeResult = Partial<LangGraphRuntimeState>;

const GraphState = Annotation.Root({
  state: Annotation<AgenticLoopState>,
  history: Annotation<AgenticActionHistoryItem[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  nextRoute: Annotation<'finalized' | 'refine'>({
    reducer: (_current, update) => update,
    default: () => 'finalized',
  }),
});

const stepNameForAction = (action: AgenticAction): string => `agentic:${action.toLowerCase()}`;

const runGraphStep = async (
  context: AgenticRuntimeContext,
  graphState: LangGraphRuntimeState,
  action: AgenticAction,
  rationale: string,
  execute: (state: AgenticLoopState) => Promise<AgenticLoopState>
): Promise<LangGraphNodeResult> => {
  const nextStepCount = graphState.state.stepCount + 1;
  assertStepBudget(context.policy, nextStepCount);

  const stateWithStep = {
    ...graphState.state,
    stepCount: nextStepCount,
  };
  const stepName = stepNameForAction(action);
  const startedAt = new Date();

  await emitAgenticStepEvent({
    context,
    stepName,
    stepStatus: 'started',
    startedAt,
    metadata: {
      rationale,
      step: nextStepCount,
      refinement: stateWithStep.refinementCount,
      runtime: 'langgraph',
    },
  });

  try {
    const nextState = await execute(stateWithStep);

    await emitAgenticStepEvent({
      context,
      stepName,
      stepStatus: 'completed',
      startedAt,
      completedAt: new Date(),
      metadata: {
        rationale,
        step: nextState.stepCount,
        refinement: nextState.refinementCount,
        reportCount: nextState.reports.length,
        questionCount: nextState.analysis?.topQuestions.length || 0,
        modelTokenUsage: action === 'SYNTHESIZE_SUMMARY' ? nextState.analysis?.usage || null : null,
        runtime: 'langgraph',
      },
    });

    return {
      state: nextState,
      history: [
        ...graphState.history,
        {
          step: nextStepCount,
          action,
          rationale,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown LangGraph agentic step error';
    await emitAgenticStepEvent({
      context,
      stepName,
      stepStatus: 'failed',
      startedAt,
      completedAt: new Date(),
      metadata: {
        rationale,
        step: nextStepCount,
        refinement: stateWithStep.refinementCount,
        runtime: 'langgraph',
      },
      errorText: message,
    });

    throw error;
  }
};

class LangGraphCaseAnalysisAdapter implements LangChainAgentAdapter {
  private readonly critic = new CriticAgent();

  private readonly finalizer = new FinalizerAgent();

  public async run(context: AgenticRuntimeContext, initialState: AgenticLoopState): Promise<LangChainRunResult> {
    const workflow = new StateGraph(GraphState)
      .addNode('validate_intake', (graphState: LangGraphRuntimeState) =>
        runGraphStep(context, graphState, 'VALIDATE_INTAKE', 'LangGraph node validates case intake.', (state) =>
          validateIntakeTool(context, state)
        )
      )
      .addNode('extract_reports', (graphState: LangGraphRuntimeState) =>
        runGraphStep(context, graphState, 'EXTRACT_REPORTS', 'LangGraph node extracts available case reports.', (state) =>
          extractReportsTool(context, state)
        )
      )
      .addNode('synthesize_summary', (graphState: LangGraphRuntimeState) =>
        runGraphStep(context, graphState, 'SYNTHESIZE_SUMMARY', 'LangGraph node synthesizes the clinical summary.', (state) =>
          synthesizeSummaryTool(context, state)
        )
      )
      .addNode('guard_questions', (graphState: LangGraphRuntimeState) =>
        runGraphStep(context, graphState, 'GUARD_QUESTIONS', 'LangGraph node validates specialist questions.', (state) =>
          guardQuestionsTool(state)
        )
      )
      .addNode('finalize', (graphState: LangGraphRuntimeState) => this.finalize(context, graphState))
      .addEdge(START, 'validate_intake')
      .addEdge('validate_intake', 'extract_reports')
      .addEdge('extract_reports', 'synthesize_summary')
      .addEdge('synthesize_summary', 'guard_questions')
      .addEdge('guard_questions', 'finalize')
      .addConditionalEdges('finalize', (graphState: LangGraphRuntimeState) => graphState.nextRoute, {
        finalized: END,
        refine: 'synthesize_summary',
      });

    const checkpointer = await getLangGraphCheckpointer();
    const threadId = buildLangGraphThreadId(context.runId);
    const graph = workflow.compile({
      checkpointer,
      name: 'secondop-case-analysis-langgraph',
    });

    const result = await graph.invoke(
      {
        state: initialState,
        history: [],
        nextRoute: 'finalized',
      },
      {
        configurable: {
          thread_id: threadId,
        },
        recursionLimit: context.policy.maxSteps + context.policy.maxRefinements + 4,
      }
    );

    if (!result.state.finalArtifact) {
      throw new AgenticError('validation_error', 'LangGraph runtime completed without a final artifact.');
    }

    return {
      state: result.state,
      history: result.history,
      artifact: result.state.finalArtifact,
    };
  }

  private async finalize(
    context: AgenticRuntimeContext,
    graphState: LangGraphRuntimeState
  ): Promise<LangGraphNodeResult> {
    const nextStepCount = graphState.state.stepCount + 1;
    assertStepBudget(context.policy, nextStepCount);

    const action: AgenticAction = 'FINALIZE';
    const rationale = 'LangGraph node finalizes and critic-checks the analysis artifact.';
    const stepName = stepNameForAction(action);
    const startedAt = new Date();
    const stateWithStep = {
      ...graphState.state,
      stepCount: nextStepCount,
    };

    await emitAgenticStepEvent({
      context,
      stepName,
      stepStatus: 'started',
      startedAt,
      metadata: {
        rationale,
        step: nextStepCount,
        refinement: stateWithStep.refinementCount,
        runtime: 'langgraph',
      },
    });

    try {
      const artifact = this.finalizer.finalize(stateWithStep);
      const criticScore = await this.critic.evaluate(artifact, stateWithStep);
      let nextState: AgenticLoopState = {
        ...stateWithStep,
        finalArtifact: artifact,
        criticScore,
      };

      await emitAgenticStepEvent({
        context,
        stepName,
        stepStatus: 'completed',
        startedAt,
        completedAt: new Date(),
        metadata: {
          rationale,
          step: nextStepCount,
          refinement: nextState.refinementCount,
          passed: criticScore.passed,
          score: criticScore.score,
          reasons: criticScore.reasons,
          runtime: 'langgraph',
        },
      });

      const history = [
        ...graphState.history,
        {
          step: nextStepCount,
          action,
          rationale,
          timestamp: new Date().toISOString(),
        },
      ];

      if (criticScore.passed) {
        return {
          state: nextState,
          history,
          nextRoute: 'finalized',
        };
      }

      if (!criticScore.needsRefinement) {
        throw new AgenticError('validation_error', `Critic rejected final output: ${criticScore.reasons.join(' ')}`);
      }

      nextState = {
        ...nextState,
        refinementCount: nextState.refinementCount + 1,
        criticFeedback: criticScore.reasons.join(' '),
        finalArtifact: null,
      };
      assertRefinementBudget(context.policy, nextState.refinementCount);

      return {
        state: nextState,
        history,
        nextRoute: 'refine',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown LangGraph finalization error';
      await emitAgenticStepEvent({
        context,
        stepName,
        stepStatus: 'failed',
        startedAt,
        completedAt: new Date(),
        metadata: {
          rationale,
          step: nextStepCount,
          refinement: stateWithStep.refinementCount,
          runtime: 'langgraph',
        },
        errorText: message,
      });

      throw error;
    }
  }
}

const defaultLangGraphAdapter = new LangGraphCaseAnalysisAdapter();

let configuredAdapter: LangChainAgentAdapter | null = null;

export const configureLangChainAdapter = (adapter: LangChainAgentAdapter): void => {
  configuredAdapter = adapter;
};

export const runAgenticViaLangChain = async (
  context: AgenticRuntimeContext,
  fallbackState: AgenticLoopState
): Promise<LangChainRunResult> => {
  const adapter = configuredAdapter || defaultLangGraphAdapter;

  try {
    return await adapter.run(context, fallbackState);
  } catch (error) {
    if (error instanceof AgenticError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new AgenticError('unknown_error', `LangChain runtime failed: ${error.message}`);
    }

    throw new AgenticError('unknown_error', 'LangChain runtime failed with unknown error');
  }
};
