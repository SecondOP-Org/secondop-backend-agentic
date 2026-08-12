import { buildStepTimeline } from '../agentic/observability/analysisObservability.service';

describe('buildStepTimeline', () => {
  it('maps agentic events into agent/action/tool rows', () => {
    const timeline = buildStepTimeline([
      {
        id: 'e1',
        step_name: 'agentic:validate_intake',
        step_status: 'started',
        started_at: '2026-08-12T00:00:00.000Z',
        metadata_json: { step: 1, refinement: 0, rationale: 'begin' },
      },
      {
        id: 'e2',
        step_name: 'agentic:validate_intake',
        step_status: 'completed',
        started_at: '2026-08-12T00:00:00.000Z',
        completed_at: '2026-08-12T00:00:01.000Z',
        metadata_json: {
          step: 1,
          refinement: 0,
          rationale: 'begin',
          plannerTokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
      {
        id: 'e3',
        step_name: 'agentic:finalize',
        step_status: 'completed',
        started_at: '2026-08-12T00:00:02.000Z',
        completed_at: '2026-08-12T00:00:03.000Z',
        metadata_json: { step: 5, refinement: 0 },
      },
    ]);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toEqual(
      expect.objectContaining({
        step: 1,
        decidedBy: 'Planner',
        action: 'VALIDATE_INTAKE',
        actionLabel: 'Validate intake',
        tool: 'Intake validation',
        executedBy: 'Intake validation tool',
        plannerTokens: 15,
        status: 'completed',
      })
    );
    expect(timeline[1]).toEqual(
      expect.objectContaining({
        step: 5,
        action: 'FINALIZE',
        tool: '—',
        executedBy: 'Finalizer, Critic',
        agents: ['Planner', 'Finalizer', 'Critic'],
      })
    );
  });
});
