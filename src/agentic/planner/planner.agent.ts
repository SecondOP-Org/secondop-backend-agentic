import OpenAI from 'openai';
import { getOpenAIClient, isLiteLlmMode, validateLiteLlmModelAlias } from '../../ai/llmGateway';
import { buildLlmRequestMetadata } from '../../ai/llmRequestMetadata';
import {
  AgenticAction,
  AgenticActionHistoryItem,
  AgenticLoopState,
  AgenticPlannerDecision,
  AgenticRuntimeContext,
  AgenticTokenUsage,
} from '../core/types';

const fallbackAction = (state: AgenticLoopState): AgenticAction => {
  if (!state.intake) {
    return 'VALIDATE_INTAKE';
  }

  if (!state.reports.length) {
    return 'EXTRACT_REPORTS';
  }

  if (!state.analysis) {
    return 'SYNTHESIZE_SUMMARY';
  }

  if (state.analysis && (!state.analysis.topQuestions.length || state.analysis.topQuestions.length !== 3)) {
    return 'GUARD_QUESTIONS';
  }

  return 'FINALIZE';
};

const mapUsage = (usage: unknown): AgenticTokenUsage => {
  const safe = (usage || {}) as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };

  return {
    promptTokens: Number(safe.prompt_tokens || 0),
    completionTokens: Number(safe.completion_tokens || 0),
    totalTokens: Number(safe.total_tokens || 0),
  };
};

export class PlannerAgent {
  public async planNextAction(
    context: AgenticRuntimeContext,
    state: AgenticLoopState,
    history: AgenticActionHistoryItem[]
  ): Promise<AgenticPlannerDecision> {
    const client = getOpenAIClient({ optional: true });
    const fallback = fallbackAction(state);

    if (!client) {
      return {
        action: fallback,
        rationale: 'Fallback planner action selected without model client.',
      };
    }

    const plannerModel = process.env.AGENTIC_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    validateLiteLlmModelAlias(plannerModel);
    const historyLines = history
      .slice(-5)
      .map((item) => `${item.step}. ${item.action} (${item.timestamp})`)
      .join('\n');

    const completionRequest: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
      metadata?: Record<string, string>;
    } = {
      model: plannerModel,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'You are a bounded planner for medical analysis workflow execution.',
            'Return strict JSON: {"action": <allowed_action>, "rationale": <string>}.',
            'Only choose from: VALIDATE_INTAKE, EXTRACT_REPORTS, SYNTHESIZE_SUMMARY, GUARD_QUESTIONS, FINALIZE.',
            'Never invent actions.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Mode: ${context.mode}`,
            `Step count: ${state.stepCount}`,
            `Refinements: ${state.refinementCount}`,
            `Has intake: ${Boolean(state.intake)}`,
            `Report count: ${state.reports.length}`,
            `Has analysis: ${Boolean(state.analysis)}`,
            `Question count: ${state.analysis?.topQuestions.length || 0}`,
            `Observation count: ${state.observations.length}`,
            `Critic feedback: ${state.criticFeedback || 'none'}`,
            `Recent history:\n${historyLines || 'none'}`,
          ].join('\n'),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'agentic_planner_decision',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: {
                type: 'string',
                enum: ['VALIDATE_INTAKE', 'EXTRACT_REPORTS', 'SYNTHESIZE_SUMMARY', 'GUARD_QUESTIONS', 'FINALIZE'],
              },
              rationale: { type: 'string' },
            },
            required: ['action', 'rationale'],
          },
        },
      },
    };

    if (isLiteLlmMode()) {
      completionRequest.metadata = buildLlmRequestMetadata({
        workflow: 'agentic_planner',
        modelAlias: plannerModel,
        caseId: context.caseId,
        runId: context.runId,
      });
    }

    const completion = await client.chat.completions.create(completionRequest);

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return {
        action: fallback,
        rationale: 'Empty planner response; fallback selected.',
        usage: mapUsage(completion.usage),
      };
    }

    try {
      const parsed = JSON.parse(raw) as AgenticPlannerDecision;
      if (!parsed.action) {
        return {
          action: fallback,
          rationale: 'Planner action missing; fallback selected.',
          usage: mapUsage(completion.usage),
        };
      }

      return {
        action: parsed.action,
        rationale: parsed.rationale || 'Planner selected action.',
        usage: mapUsage(completion.usage),
      };
    } catch {
      return {
        action: fallback,
        rationale: 'Planner JSON parse failed; fallback selected.',
        usage: mapUsage(completion.usage),
      };
    }
  }
}
