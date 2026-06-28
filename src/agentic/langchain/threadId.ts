export const LANGGRAPH_CASE_ANALYSIS_THREAD_PREFIX = 'case-analysis';

export const buildLangGraphThreadId = (runId: string): string => {
  const normalizedRunId = runId.trim();

  if (!normalizedRunId) {
    throw new Error('LangGraph workflow thread_id requires a non-empty runId.');
  }

  return `${LANGGRAPH_CASE_ANALYSIS_THREAD_PREFIX}:${normalizedRunId}`;
};
