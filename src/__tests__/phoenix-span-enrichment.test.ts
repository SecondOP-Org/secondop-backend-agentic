import {
  flattenSpanMetadata,
  OPENINFERENCE_SPAN_KIND,
  resetPhoenixObservabilityForTests,
  setPhoenixOtelApiForTests,
  startPhoenixSpan,
} from '../observability/phoenix.service';

describe('phoenix.service span enrichment (SEC-107)', () => {
  afterEach(() => {
    resetPhoenixObservabilityForTests();
  });

  it('no-ops when Phoenix is disabled', async () => {
    setPhoenixOtelApiForTests(null, false);
    const span = startPhoenixSpan('analysis.agentic.run', { caseId: 'c1' }, 'CHAIN');
    span.addAttributes({ latency_ms: 12 });
    await span.run(async () => 'ok');
    span.end('OK');
  });

  it('sets openinference.span.kind and nests children under active parent', async () => {
    const started: Array<{ name: string; attributes?: Record<string, unknown>; parent?: string }> = [];
    const spanStore = new Map<object, { name: string; ended: boolean; attrs: Record<string, unknown> }>();

    const api = {
      context: {
        active: () => ({}),
        with: <T>(_ctx: unknown, fn: () => T): T => fn(),
      },
      trace: {
        getTracer: () => ({
          startSpan: (
            name: string,
            options?: { attributes?: Record<string, unknown> },
            ctx?: { parent?: object }
          ) => {
            const handle: {
              setAttributes: (attrs: Record<string, unknown>) => void;
              setStatus: () => void;
              recordException: () => void;
              end: () => void;
            } = {
              setAttributes: (attrs: Record<string, unknown>) => {
                const entry = spanStore.get(handle)!;
                entry.attrs = { ...entry.attrs, ...attrs };
              },
              setStatus: () => {},
              recordException: () => {},
              end: () => {
                spanStore.get(handle)!.ended = true;
              },
            };
            const parentName = ctx?.parent ? spanStore.get(ctx.parent)?.name : undefined;
            started.push({ name, attributes: options?.attributes, parent: parentName });
            spanStore.set(handle, {
              name,
              ended: false,
              attrs: { ...(options?.attributes || {}) },
            });
            return handle;
          },
        }),
        setSpan: (ctx: object, span: object) => ({ ...ctx, parent: span }),
      },
      SpanStatusCode: { OK: 1, ERROR: 2 },
      metrics: {
        getMeter: () => ({
          createCounter: () => ({ add: () => {} }),
        }),
      },
    };

    setPhoenixOtelApiForTests(api as any, true);

    const runSpan = startPhoenixSpan('analysis.agentic.run', { caseId: 'c1', runId: 'r1' }, 'CHAIN');
    await runSpan.run(async () => {
      const stepSpan = startPhoenixSpan(
        'agentic.step.agentic:synthesize_summary',
        { caseId: 'c1', runId: 'r1', mode: 'agentic' },
        'TOOL'
      );
      await stepSpan.run(async () => {
        const llmSpan = startPhoenixSpan('llm.case_analysis', { 'gen_ai.request.model': 'gpt-test' }, 'LLM');
        llmSpan.end('OK');
      });
      stepSpan.end('OK');
    });
    runSpan.end('OK');

    expect(started[0]?.attributes?.[OPENINFERENCE_SPAN_KIND]).toBe('CHAIN');
    expect(started[1]?.attributes?.[OPENINFERENCE_SPAN_KIND]).toBe('TOOL');
    expect(started[2]?.attributes?.[OPENINFERENCE_SPAN_KIND]).toBe('LLM');
    expect(started[1]?.parent).toBe('analysis.agentic.run');
    expect(started[2]?.parent).toBe('agentic.step.agentic:synthesize_summary');
  });

  it('truncates rationale and flattens planner token usage', () => {
    const long = 'x'.repeat(600);
    const flat = flattenSpanMetadata({
      rationale: long,
      plannerTokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    expect(String(flat.rationale).length).toBeLessThanOrEqual(501);
    expect(flat.planner_prompt_tokens).toBe(10);
    expect(flat.planner_completion_tokens).toBe(5);
    expect(flat.planner_total_tokens).toBe(15);
  });
});
