/**
 * Async-local log context for the analysis path (SEC-116).
 *
 * Binds `runId` (and, once available, `trace_id`) to every winston log line
 * emitted while an analysis run is in flight, without threading extra
 * parameters through every function call. PHI RULE: only ids belong here —
 * never case content, prompts, or model output.
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface AnalysisLogContext {
  runId?: string;
  traceId?: string;
}

const analysisLogContextStorage = new AsyncLocalStorage<AnalysisLogContext>();

/** Run `fn` with `context` bound as the active analysis log context. */
export const withAnalysisLogContext = async <T>(
  context: AnalysisLogContext,
  fn: () => Promise<T> | T
): Promise<T> => {
  return analysisLogContextStorage.run({ ...context }, fn);
};

export const getAnalysisLogContext = (): AnalysisLogContext | undefined =>
  analysisLogContextStorage.getStore();

/**
 * Attach the trace id to the currently active analysis log context, if one
 * exists. Sticky for the remainder of the async chain (e.g. after the
 * originating Phoenix span ends), so later logs in the same run keep it.
 * No-op outside an active `withAnalysisLogContext` scope.
 */
export const setAnalysisLogTraceId = (traceId: string | undefined): void => {
  if (!traceId) {
    return;
  }

  const store = analysisLogContextStorage.getStore();
  if (store) {
    store.traceId = traceId;
  }
};
