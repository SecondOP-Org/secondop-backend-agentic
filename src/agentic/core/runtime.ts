import { emitAgenticStepEvent, runWithinAgenticStepSpan } from '../observability/eventEmitter';
import { persistAgenticStageArtifact } from '../observability/artifactPersistence';
import {
  addTokenUsage,
  assertActionAllowed,
  assertRefinementBudget,
  assertResourceBudgets,
  assertStepBudget,
  emptyTokenUsage,
} from './policy';
import {
  AgenticAction,
  AgenticActionHistoryItem,
  AgenticError,
  AgenticErrorDetails,
  AgenticLoopState,
  AgenticRuntimeContext,
  AgenticTokenUsage,
} from './types';
import { PlannerAgent } from '../planner/planner.agent';
import { CriticAgent } from '../critic/critic.agent';
import { FinalizerAgent } from '../finalizer/finalizer.agent';
import { estimateTokenCostUsd } from '../../observability/phoenix.service';
import { buildAgenticRunMetrics } from '../observability/metrics';

interface RuntimeTools {
  VALIDATE_INTAKE: (context: AgenticRuntimeContext, state: AgenticLoopState) => Promise<AgenticLoopState>;
  EXTRACT_REPORTS: (context: AgenticRuntimeContext, state: AgenticLoopState) => Promise<AgenticLoopState>;
  GROUND_EVIDENCE?: (context: AgenticRuntimeContext, state: AgenticLoopState) => Promise<AgenticLoopState>;
  SYNTHESIZE_SUMMARY: (context: AgenticRuntimeContext, state: AgenticLoopState) => Promise<AgenticLoopState>;
  GUARD_QUESTIONS: (context: AgenticRuntimeContext, state: AgenticLoopState) => Promise<AgenticLoopState>;
}

interface RunRuntimeInput {
  context: AgenticRuntimeContext;
  initialState: AgenticLoopState;
  planner: PlannerAgent;
  critic: CriticAgent;
  finalizer: FinalizerAgent;
  tools: RuntimeTools;
}

const usageFromAnalysis = (state: AgenticLoopState): AgenticTokenUsage => ({
  promptTokens: state.analysis?.usage?.promptTokens || 0,
  completionTokens: state.analysis?.usage?.completionTokens || 0,
  totalTokens: state.analysis?.usage?.totalTokens || 0,
});

export const runAgenticRuntime = async (input: RunRuntimeInput) => {
  let state: AgenticLoopState = {
    ...input.initialState,
    startedAtMs: input.initialState.startedAtMs ?? Date.now(),
    runningTokenUsage: input.initialState.runningTokenUsage || emptyTokenUsage(),
    modelTokenUsageAccumulated: input.initialState.modelTokenUsageAccumulated || emptyTokenUsage(),
  };
  const history: AgenticActionHistoryItem[] = [];
  const startedAtMs = state.startedAtMs!;

  while (true) {
    state = {
      ...state,
      stepCount: state.stepCount + 1,
    };

    assertStepBudget(input.context.policy, state.stepCount);
    assertResourceBudgets(input.context.policy, startedAtMs, state.runningTokenUsage || emptyTokenUsage());

    const decision = await input.planner.planNextAction(input.context, state, history);
    const action = assertActionAllowed(input.context.policy, decision.action);
    const stepName = `agentic:${action.toLowerCase()}`;
    const startedAt = new Date();

    state = {
      ...state,
      runningTokenUsage: addTokenUsage(state.runningTokenUsage || emptyTokenUsage(), decision.usage),
    };
    assertResourceBudgets(input.context.policy, startedAtMs, state.runningTokenUsage || emptyTokenUsage());

    await emitAgenticStepEvent({
      context: input.context,
      stepName,
      stepStatus: 'started',
      startedAt,
      metadata: {
        rationale: decision.rationale,
        step: state.stepCount,
        refinement: state.refinementCount,
        plannerTokenUsage: decision.usage || null,
      },
    });

    try {
      if (action === 'FINALIZE') {
        await runWithinAgenticStepSpan({ stepName, startedAt }, async () => {
          const artifact = input.finalizer.finalize(state);
          const criticScore = await input.critic.evaluate(artifact, state, input.context.policy);

          state = {
            ...state,
            finalArtifact: artifact,
            criticScore,
          };
        });

        await emitAgenticStepEvent({
          context: input.context,
          stepName,
          stepStatus: 'completed',
          startedAt,
          completedAt: new Date(),
          metadata: {
            passed: state.criticScore?.passed,
            score: state.criticScore?.score,
            reasons: state.criticScore?.reasons,
            plannerTokenUsage: decision.usage || null,
          },
        });

        await persistAgenticStageArtifact('FINALIZE', input.context, state);

        history.push({
          step: state.stepCount,
          action,
          rationale: decision.rationale,
          timestamp: new Date().toISOString(),
          usage: decision.usage,
        });

        if (state.criticScore?.passed) {
          return {
            state,
            history,
          };
        }

        if (!state.criticScore?.needsRefinement) {
          throw new AgenticError(
            'validation_error',
            `Critic rejected final output: ${(state.criticScore?.reasons || []).join(' ')}`
          );
        }

        state = {
          ...state,
          refinementCount: state.refinementCount + 1,
          criticFeedback: (state.criticScore?.reasons || []).join(' '),
          finalArtifact: null,
        };

        assertRefinementBudget(input.context.policy, state.refinementCount);
        assertResourceBudgets(input.context.policy, startedAtMs, state.runningTokenUsage || emptyTokenUsage());
        continue;
      }

      const toolKey = action as Exclude<AgenticAction, 'FINALIZE'>;
      const tool = input.tools[toolKey];
      if (!tool) {
        throw new AgenticError('policy_error', `No tool registered for action: ${action}`);
      }

      const priorModelUsage = state.modelTokenUsageAccumulated || emptyTokenUsage();
      state = await runWithinAgenticStepSpan({ stepName, startedAt }, () => tool(input.context, state));

      if (action === 'SYNTHESIZE_SUMMARY') {
        const synthesizeUsage = usageFromAnalysis(state);
        const modelTokenUsageAccumulated = addTokenUsage(priorModelUsage, synthesizeUsage);
        state = {
          ...state,
          modelTokenUsageAccumulated,
          runningTokenUsage: addTokenUsage(
            {
              promptTokens: (state.runningTokenUsage || emptyTokenUsage()).promptTokens,
              completionTokens: (state.runningTokenUsage || emptyTokenUsage()).completionTokens,
              totalTokens: (state.runningTokenUsage || emptyTokenUsage()).totalTokens,
            },
            synthesizeUsage
          ),
        };
        // runningTokenUsage already includes planner usage from this step; add synthesize only once.
        assertResourceBudgets(input.context.policy, startedAtMs, state.runningTokenUsage || emptyTokenUsage());
      }

      await emitAgenticStepEvent({
        context: input.context,
        stepName,
        stepStatus: 'completed',
        startedAt,
        completedAt: new Date(),
        metadata: {
          rationale: decision.rationale,
          step: state.stepCount,
          refinement: state.refinementCount,
          reportCount: state.reports.length,
          questionCount: state.analysis?.topQuestions.length || 0,
          modelTokenUsage: action === 'SYNTHESIZE_SUMMARY' ? state.analysis?.usage || null : null,
          plannerTokenUsage: decision.usage || null,
        },
      });

      await persistAgenticStageArtifact(action, input.context, state);

      history.push({
        step: state.stepCount,
        action,
        rationale: decision.rationale,
        timestamp: new Date().toISOString(),
        usage: decision.usage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown agentic step error';
      const partialMetrics = buildAgenticRunMetrics(state, history);
      const details: AgenticErrorDetails = {
        stepCount: partialMetrics.stepCount,
        refinementCount: partialMetrics.refinementCount,
        actionSequence: partialMetrics.actionSequence,
        agentsInvoked: partialMetrics.agentsInvoked,
        promptTokens: partialMetrics.totalTokenUsage.promptTokens,
        completionTokens: partialMetrics.totalTokenUsage.completionTokens,
        totalTokens: partialMetrics.totalTokenUsage.totalTokens,
        plannerPromptTokens: partialMetrics.plannerTokenUsage.promptTokens,
        plannerCompletionTokens: partialMetrics.plannerTokenUsage.completionTokens,
        modelPromptTokens: partialMetrics.modelTokenUsage.promptTokens,
        modelCompletionTokens: partialMetrics.modelTokenUsage.completionTokens,
        estimatedCostUsd: estimateTokenCostUsd(
          partialMetrics.totalTokenUsage.promptTokens,
          partialMetrics.totalTokenUsage.completionTokens
        ),
      };

      await emitAgenticStepEvent({
        context: input.context,
        stepName,
        stepStatus: 'failed',
        startedAt,
        completedAt: new Date(),
        metadata: {
          rationale: decision.rationale,
          step: state.stepCount,
          refinement: state.refinementCount,
          plannerTokenUsage: decision.usage || null,
          budgetStopReason: error instanceof AgenticError ? error.budgetStopReason || null : null,
        },
        errorText: message,
      });

      if (error instanceof AgenticError) {
        throw new AgenticError(error.code, error.message, error.budgetStopReason, {
          ...details,
          ...error.details,
        });
      }

      throw error;
    }
  }
};
