import logger from '../../utils/logger';
import { normalizeAgenticError } from '../core/types';
import { buildAgenticPolicy } from '../core/policy';
import { runAgenticRuntime } from '../core/runtime';
import { PlannerAgent } from '../planner/planner.agent';
import { CriticAgent } from '../critic/critic.agent';
import { FinalizerAgent } from '../finalizer/finalizer.agent';
import { extractReportsTool } from '../tools/extract.tool';
import { guardQuestionsTool } from '../tools/question_guard.tool';
import { validateIntakeTool } from '../tools/intake.tool';
import { persistShadowTool } from '../tools/persist_shadow.tool';
import { synthesizeSummaryTool } from '../tools/synthesize.tool';
import { AgenticMode, AgenticRuntimeContext } from '../core/types';
import { buildAgenticRunMetrics } from '../observability/metrics';
import { isLangChainFallbackAllowed } from '../../config/agenticRuntime';
import { isLangChainRuntimeEnabled, runAgenticViaLangChain } from '../langchain/adapter';

interface RunAgenticCaseAnalysisOptions {
  caseId: string;
  runId: string;
  mode: AgenticMode;
  maxCharsPerFile: number;
  maxTotalChars: number;
}

export const runAgenticCaseAnalysis = async (options: RunAgenticCaseAnalysisOptions) => {
  const context: AgenticRuntimeContext = {
    caseId: options.caseId,
    runId: options.runId,
    mode: options.mode,
    maxCharsPerFile: options.maxCharsPerFile,
    maxTotalChars: options.maxTotalChars,
    policy: buildAgenticPolicy(),
    model: process.env.AGENTIC_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  };

  const planner = new PlannerAgent();
  const critic = new CriticAgent();
  const finalizer = new FinalizerAgent();
  const initialState = {
    caseId: options.caseId,
    runId: options.runId,
    mode: options.mode,
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

  try {
    const runNativeRuntime = async () =>
      runAgenticRuntime({
        context,
        planner,
        critic,
        finalizer,
        initialState,
        tools: {
          VALIDATE_INTAKE: validateIntakeTool,
          EXTRACT_REPORTS: extractReportsTool,
          SYNTHESIZE_SUMMARY: synthesizeSummaryTool,
          GUARD_QUESTIONS: async (_context, state) => guardQuestionsTool(state),
        },
      });

    let runtimeResult;
    if (isLangChainRuntimeEnabled()) {
      try {
        const langchainResult = await runAgenticViaLangChain(context, initialState);
        runtimeResult = {
          state: langchainResult.state,
          history: langchainResult.history,
        };
        logger.info(`LangChain runtime used for case ${options.caseId} (run ${options.runId})`);
      } catch (error) {
        const fallbackAllowed = isLangChainFallbackAllowed();
        if (!fallbackAllowed) {
          throw error;
        }

        const fallbackReason = error instanceof Error ? error.message : 'Unknown LangChain runtime error';
        logger.warn(
          `LangChain runtime failed; falling back to native runtime for case ${options.caseId} (run ${options.runId}): ${fallbackReason}`
        );
        runtimeResult = await runNativeRuntime();
      }
    } else {
      runtimeResult = await runNativeRuntime();
    }

    if (!runtimeResult.state.finalArtifact) {
      throw new Error('Final artifact missing after runtime completion.');
    }

    await persistShadowTool({
      context,
      state: runtimeResult.state,
      artifact: runtimeResult.state.finalArtifact,
      finalStatus: 'succeeded',
    });

    const metrics = buildAgenticRunMetrics(runtimeResult.state, runtimeResult.history);
    logger.info(`Agentic analysis completed for case ${options.caseId} (run ${options.runId})`, {
      mode: options.mode,
      ...metrics,
    });

    return {
      artifact: runtimeResult.state.finalArtifact,
      criticScore: runtimeResult.state.criticScore,
      history: runtimeResult.history,
      metrics,
    };
  } catch (error) {
    const normalized = normalizeAgenticError(error, 'unknown_error');

    await persistShadowTool({
      context,
      state: {
        ...initialState,
      },
      artifact: {
        summary: '',
        questions: [],
        observations: [],
        artifact: {
          structured_summary: {
            chief_concern: '',
            key_report_findings: '',
            red_flags_to_discuss: '',
            follow_up_discussion_points: '',
            limitations_caveats: '',
          },
          questionnaire: {
            specialist_questions: [],
          },
          confidence_score: 0,
          uncertainty_flags: [],
          disclaimer: '',
          evidence_refs: [],
          model: context.model,
          token_usage: null,
        },
        model: context.model,
      },
      finalStatus: 'failed',
      error: `[${normalized.code}] ${normalized.message}`,
    });

    throw normalized;
  }
};
