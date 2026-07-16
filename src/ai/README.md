# `src/ai/`

**What lives here:** LLM gateway and request metadata (`llmGateway.ts`, `llmRequestMetadata.ts`) used by analysis services.

**What does not:** Case-analysis agents, agentic orchestration, or eval harnesses.

**One rule:** All model calls go through the gateway helpers — do not open ad-hoc provider SDKs from controllers.
