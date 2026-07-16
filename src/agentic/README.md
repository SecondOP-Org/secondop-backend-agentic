# `src/agentic/`

**What lives here:** Agentic runtime — execution mode, native loop, optional LangGraph adapter, planner/critic/finalizer, and tools.

**What does not:** The baseline sequential orchestrator (`src/agents/core/`), raw LLM HTTP gateway (`src/ai/llmGateway.ts`), or persistence schemas (migrations/).

**One rule:** Check `executionMode.ts` before assuming this tree is (or is not) user-facing — mode is env-driven (`baseline` | `shadow` | `agentic`).
