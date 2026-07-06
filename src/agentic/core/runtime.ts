import { emitAgenticStepEvent } from '../observability/eventEmitter';
import { persistAgenticStageArtifact } from '../observability/artifactPersistence';
import { assertActionAllowed, assertRefinementBudget, assertStepBudget } from './policy';
import {
  AgenticAction,
  AgenticActionHistoryItem,
  AgenticError,
  AgenticLoopState,
  AgenticRuntimeContext,
} from './types';
import { PlannerAgent } from '../planner/planner.agent';
import { CriticAgent } from '../critic/critic.agent';
import { FinalizerAgent } from '../finalizer/finalizer.agent';

interface RuntimeTools {
  VALIDATE_INTAKE: (context: AgenticRuntimeContext, state: AgenticLoopState) => Promise<AgenticLoopState>;
  EXTRACT_REPORTS: (context: AgenticRuntimeContext, state: AgenticLoopState) => Promise<AgenticLoopState>;
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

export const runAgenticRuntime = async (input: RunRuntimeInput) => {
  let state = input.initialState;
  const history: AgenticActionHistoryItem[] = [];

  while (true) {
    state = {
      ...state,
      stepCount: state.stepCount + 1,
    };

    assertStepBudget(input.context.policy, state.stepCount);

    const decision = await input.planner.planNextAction(input.context, state, history);
    const action = assertActionAllowed(input.context.policy, decision.action);
    const stepName = `agentic:${action.toLowerCase()}`;
    const startedAt = new Date();

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
        const artifact = input.finalizer.finalize(state);
        const criticScore = await input.critic.evaluate(artifact, state);

        state = {
          ...state,
          finalArtifact: artifact,
          criticScore,
        };

        await emitAgenticStepEvent({
          context: input.context,
          stepName,
          stepStatus: 'completed',
          startedAt,
          completedAt: new Date(),
          metadata: {
            passed: criticScore.passed,
            score: criticScore.score,
            reasons: criticScore.reasons,
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

        if (criticScore.passed) {
          return {
            state,
            history,
          };
        }

        if (!criticScore.needsRefinement) {
          throw new AgenticError('validation_error', `Critic rejected final output: ${criticScore.reasons.join(' ')}`);
        }

        state = {
          ...state,
          refinementCount: state.refinementCount + 1,
          criticFeedback: criticScore.reasons.join(' '),
          finalArtifact: null,
        };

        assertRefinementBudget(input.context.policy, state.refinementCount);
        continue;
      }

      const tool = input.tools[action as Exclude<AgenticAction, 'FINALIZE'>];
      state = await tool(input.context, state);

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
        },
        errorText: message,
      });

      throw error;
    }
  }
};
