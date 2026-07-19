/**
 * Phoenix / OpenTelemetry tracing for case analysis.
 *
 * PHI RULE: never attach prompt or completion bodies (or any clinical text) to spans.
 * Attribute allowlist only: ids, counts, model names, token usage, latency, cost, status.
 */
import { AsyncLocalStorage } from 'async_hooks';
import logger from '../utils/logger';

export type PhoenixSpanKind = 'AGENT' | 'TOOL' | 'LLM' | 'CHAIN';
type SpanStatusCode = 'OK' | 'ERROR';

interface OpenTelemetrySpanContext {
  traceId: string;
  spanId: string;
}

interface OpenTelemetrySpan {
  setAttributes: (attributes: Record<string, string | number | boolean>) => void;
  setStatus: (status: { code: number; message?: string }) => void;
  recordException: (exception: Error) => void;
  end: () => void;
  /** Standard OTel API; optional so lightweight test-only span mocks remain valid. */
  spanContext?: () => OpenTelemetrySpanContext;
}

interface OpenTelemetryContext {
  // Opaque context carrier from @opentelemetry/api
  [key: symbol]: unknown;
}

interface OpenTelemetryTracer {
  startSpan: (
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
    context?: OpenTelemetryContext
  ) => OpenTelemetrySpan;
}

interface OpenTelemetryCounter {
  add: (value: number, attributes?: Record<string, string | number | boolean>) => void;
}

interface OpenTelemetryApiModule {
  context: {
    active: () => OpenTelemetryContext;
    with: <T>(ctx: OpenTelemetryContext, fn: () => T) => T;
  };
  trace: {
    getTracer: (name: string) => OpenTelemetryTracer;
    setSpan: (context: OpenTelemetryContext, span: OpenTelemetrySpan) => OpenTelemetryContext;
  };
  metrics?: {
    getMeter: (name: string) => {
      createCounter: (name: string, options?: { description?: string }) => OpenTelemetryCounter;
    };
  };
  SpanStatusCode?: {
    OK?: number;
    ERROR?: number;
  };
}

interface PhoenixOtelModule {
  register: (options: { projectName: string; url?: string; apiKey?: string }) => void;
}

export const OPENINFERENCE_SPAN_KIND = 'openinference.span.kind';

const shouldEnablePhoenix = (): boolean => {
  const raw = (process.env.PHOENIX_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

/** Flatten nested token usage / truncate rationale for safe span attributes. */
export const flattenSpanMetadata = (
  metadata?: Record<string, unknown> | null
): Record<string, string | number | boolean> => {
  if (!metadata) {
    return {};
  }

  const output: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (key === 'rationale' && typeof value === 'string') {
      output.rationale = value.length > 500 ? `${value.slice(0, 500)}…` : value;
      continue;
    }

    if (
      (key === 'plannerTokenUsage' || key === 'modelTokenUsage') &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const usage = value as Record<string, unknown>;
      const prefix = key === 'plannerTokenUsage' ? 'planner' : 'model';
      const prompt = Number(usage.promptTokens ?? usage.prompt_tokens ?? 0);
      const completion = Number(usage.completionTokens ?? usage.completion_tokens ?? 0);
      const total = Number(usage.totalTokens ?? usage.total_tokens ?? prompt + completion);
      output[`${prefix}_prompt_tokens`] = prompt;
      output[`${prefix}_completion_tokens`] = completion;
      output[`${prefix}_total_tokens`] = total;
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
    } else {
      output[key] = JSON.stringify(value);
    }
  }

  return output;
};

let initialized = false;
let enabled = false;
let otelApi: OpenTelemetryApiModule | null = null;

const activeSpanStorage = new AsyncLocalStorage<OpenTelemetrySpan>();

let failClosedCounter: OpenTelemetryCounter | null = null;
let groundingRejectsCounter: OpenTelemetryCounter | null = null;
let phiEntitiesCounter: OpenTelemetryCounter | null = null;
let retriesCounter: OpenTelemetryCounter | null = null;
let imagePhiRedactionsCounter: OpenTelemetryCounter | null = null;

const spanStatusCode = (status: SpanStatusCode): number => {
  const fallback = status === 'ERROR' ? 2 : 1;
  if (!otelApi?.SpanStatusCode) {
    return fallback;
  }
  return status === 'ERROR'
    ? (otelApi.SpanStatusCode.ERROR ?? fallback)
    : (otelApi.SpanStatusCode.OK ?? fallback);
};

const initCounters = (): void => {
  if (!otelApi?.metrics?.getMeter) {
    return;
  }

  try {
    const meter = otelApi.metrics.getMeter('secondop.guardrails');
    failClosedCounter = meter.createCounter('fail_closed_total', {
      description: 'Fail-closed safety events (deid halt / PHI guard)',
    });
    groundingRejectsCounter = meter.createCounter('grounding_rejects_total', {
      description: 'Evidence grounding / contract rejects',
    });
    phiEntitiesCounter = meter.createCounter('phi_entities_detected_total', {
      description: 'PHI entities detected during de-identification',
    });
    retriesCounter = meter.createCounter('retries_total', {
      description: 'Transient analysis run retries (SEC-121)',
    });
    imagePhiRedactionsCounter = meter.createCounter('image_phi_redactions_total', {
      description: 'Image/DICOM pixel PHI redaction operations (SEC-129)',
    });
  } catch (error) {
    logger.warn('Failed to create Phoenix guardrail counters', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const initializePhoenixObservability = (): void => {
  if (initialized) {
    return;
  }

  initialized = true;
  enabled = shouldEnablePhoenix();

  if (!enabled) {
    return;
  }

  try {
    const phoenix = require('@arizeai/phoenix-otel') as PhoenixOtelModule;
    phoenix.register({
      projectName: process.env.PHOENIX_PROJECT_NAME || 'secondop-agent-analysis',
      url: process.env.PHOENIX_COLLECTOR_URL || process.env.PHOENIX_URL,
      apiKey: process.env.PHOENIX_API_KEY,
    });

    otelApi = require('@opentelemetry/api') as OpenTelemetryApiModule;
    initCounters();
    logger.info('Phoenix tracing enabled.');
  } catch (error) {
    enabled = false;
    logger.warn('Phoenix tracing requested but dependencies are unavailable.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export interface SpanHandle {
  addAttributes: (metadata?: Record<string, unknown> | null) => void;
  end: (status: SpanStatusCode, errorMessage?: string) => void;
  /** Run work with this span as the active parent for nested child spans. */
  run: <T>(fn: () => Promise<T> | T) => Promise<T>;
}

const noopSpan = (): SpanHandle => ({
  addAttributes: () => {},
  end: () => {},
  run: async (fn) => fn(),
});

export const isPhoenixEnabled = (): boolean => enabled;

/**
 * The OTel trace id for the currently active span (SEC-116), for log↔trace
 * correlation. Returns undefined when Phoenix is disabled or there is no
 * active span — callers should omit `trace_id` from logs in that case.
 */
export const getActiveTraceId = (): string | undefined => {
  if (!enabled) {
    return undefined;
  }

  const span = activeSpanStorage.getStore();
  if (!span?.spanContext) {
    return undefined;
  }

  try {
    return span.spanContext().traceId || undefined;
  } catch (error) {
    logger.warn('Failed to read active Phoenix span trace id', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
};

export const startPhoenixSpan = (
  name: string,
  metadata?: Record<string, unknown> | null,
  kind?: PhoenixSpanKind
): SpanHandle => {
  if (!enabled || !otelApi) {
    return noopSpan();
  }

  try {
    const tracer = otelApi.trace.getTracer('secondop.agentic');
    const attributes = {
      ...flattenSpanMetadata(metadata),
      ...(kind ? { [OPENINFERENCE_SPAN_KIND]: kind } : {}),
    };

    const parentFromAls = activeSpanStorage.getStore();
    const parentContext = parentFromAls
      ? otelApi.trace.setSpan(otelApi.context.active(), parentFromAls)
      : otelApi.context.active();

    const span = tracer.startSpan(name, { attributes }, parentContext);

    return {
      addAttributes: (extra) => {
        const attrs = flattenSpanMetadata(extra);
        if (Object.keys(attrs).length > 0) {
          span.setAttributes(attrs);
        }
      },
      end: (status, errorMessage) => {
        span.setStatus({
          code: spanStatusCode(status),
          message: errorMessage,
        });
        if (status === 'ERROR' && errorMessage) {
          span.recordException(new Error(errorMessage));
        }
        span.end();
      },
      run: async (fn) => {
        const childContext = otelApi!.trace.setSpan(otelApi!.context.active(), span);
        return activeSpanStorage.run(span, () => otelApi!.context.with(childContext, fn));
      },
    };
  } catch (error) {
    logger.warn('Failed to create Phoenix span', {
      spanName: name,
      error: error instanceof Error ? error.message : String(error),
    });
    return noopSpan();
  }
};

export const incrementFailClosed = (attrs?: Record<string, string | number | boolean>): void => {
  failClosedCounter?.add(1, attrs);
};

export const incrementGroundingRejects = (attrs?: Record<string, string | number | boolean>): void => {
  groundingRejectsCounter?.add(1, attrs);
};

export const incrementPhiEntitiesDetected = (
  count: number,
  attrs?: Record<string, string | number | boolean>
): void => {
  if (count > 0) {
    phiEntitiesCounter?.add(count, attrs);
  }
};

export const incrementRetriesTotal = (attrs?: Record<string, string | number | boolean>): void => {
  retriesCounter?.add(1, attrs);
};

export const incrementImagePhiRedactions = (
  count = 1,
  attrs?: Record<string, string | number | boolean>
): void => {
  if (count > 0) {
    imagePhiRedactionsCounter?.add(count, attrs);
  }
};

/** Rough USD estimate for span attrs only — not billing-grade. */
export const estimateTokenCostUsd = (promptTokens: number, completionTokens: number): number => {
  const inputPerMillion = 0.4;
  const outputPerMillion = 1.6;
  return Number(
    ((promptTokens * inputPerMillion + completionTokens * outputPerMillion) / 1_000_000).toFixed(6)
  );
};

/** Test helper: reset module init state. */
export const resetPhoenixObservabilityForTests = (): void => {
  initialized = false;
  enabled = false;
  otelApi = null;
  failClosedCounter = null;
  groundingRejectsCounter = null;
  phiEntitiesCounter = null;
  retriesCounter = null;
  imagePhiRedactionsCounter = null;
};

/** Test helper: force-enable with a mock OTel API. */
export const setPhoenixOtelApiForTests = (
  api: OpenTelemetryApiModule | null,
  isEnabled = true
): void => {
  initialized = true;
  enabled = Boolean(api) && isEnabled;
  otelApi = api;
  if (api) {
    initCounters();
  } else {
    failClosedCounter = null;
    groundingRejectsCounter = null;
    phiEntitiesCounter = null;
    retriesCounter = null;
    imagePhiRedactionsCounter = null;
  }
};
