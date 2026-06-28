# LangGraph Runtime Notes

## Why LangGraph Here

SecondOp already had a native agentic loop for case analysis. SEC-43 introduces LangGraph as an alternate runtime behind `AGENTIC_RUNTIME=langchain` so we can learn and validate graph execution without replacing the default production path.

The first graph intentionally mirrors the existing workflow:

1. Validate intake
2. Extract reports
3. Synthesize summary
4. Guard specialist questions
5. Finalize and critic-check
6. Route back to synthesis only when critic refinement is allowed

## Basic Concepts

- State: the data carried through the graph. In this repo, the graph wraps the existing `AgenticLoopState` plus action history and a small routing field.
- Node: one named unit of work. Our first nodes map to existing tools and agents, such as `validate_intake`, `extract_reports`, and `finalize`.
- Edge: the normal path from one node to the next.
- Conditional edge: a router that chooses the next node based on state. We use this after `finalize` to either end the graph or route back to `synthesize_summary` for critic-driven refinement.
- Checkpointer: LangGraph persistence for graph progress. SEC-44 uses the official JS `PostgresSaver` from `@langchain/langgraph-checkpoint-postgres` so graph state can survive process restarts.
- Interrupt: a human-in-the-loop pause. This PR documents the concept but does not add medical-flow interrupts yet. Future use should target explicit approval gates, such as release or high-risk AI workflow decisions.
- Command: the resume/update mechanism used with interrupts when a graph continues after human input.

## Runtime Selection

- Default: `AGENTIC_RUNTIME=native` or unset.
- LangGraph path: set `AGENTIC_RUNTIME=langchain`.
- Fallback: `AGENTIC_LANGCHAIN_ALLOW_FALLBACK=true` keeps native fallback enabled if the LangGraph runtime fails.
- Checkpoint schema: `LANGGRAPH_CHECKPOINT_SCHEMA=public` by default. The migration creates the official LangGraph checkpoint tables in the default schema.

## Durable Checkpoints

- Workflow thread IDs use `case-analysis:<runId>` so a backend analysis run maps to a stable LangGraph thread.
- Checkpoints are stored in Postgres tables managed by the official LangGraph JS Postgres saver: `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, and `checkpoint_migrations`.
- The adapter calls `PostgresSaver.setup()` as a startup guard, while `migrations/010_langgraph_checkpoints.sql` keeps fresh worktrees and deployed databases explicit.
- Command Center exposes an aggregate read model only: status, thread prefix, thread count, checkpoint count, and latest checkpoint id. It does not expose checkpoint payloads or clinical state.
- Failure paths are logged through the backend logger and, for graph steps, through the existing agentic step event emitter.

## Current Limits

- LangGraph is not the default production runtime yet.
- Human approval interrupts are not wired into the case-analysis graph yet.
- The graph uses deterministic routing over the current workflow rather than an LLM planner node.
- Temporal is not used yet; add it only if we need cross-service, long-running workflow orchestration beyond LangGraph checkpoint/resume.

## Next Learning Steps

1. Compare `src/agentic/core/runtime.ts` with `src/agentic/langchain/adapter.ts`.
2. Trace how graph state changes after each node.
3. Add a human interrupt only at a clear approval boundary.
4. Evaluate Temporal only after we have a real long-running orchestration need that LangGraph checkpoints do not cover.
