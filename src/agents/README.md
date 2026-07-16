# `src/agents/`

**What lives here:** Baseline case-analysis agents and the sequential orchestrator (`core/agent.orchestrator.ts`, `case-analysis/*.agent.ts`).

**What does not:** LangGraph / native agentic loop (see `src/agentic/`), LLM gateway (`src/ai/`), or HTTP controllers.

**One rule:** Pipeline step logic belongs in agents + services they call — never in Express controllers.
