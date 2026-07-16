# `src/evals/`

**What lives here:** Contract checks and critic/contract eval harnesses that enforce `AI_CONTRACT.md`.

**What does not:** Production request handlers or live analysis orchestration.

**One rule:** If you change LLM output shape or medical guardrails, update and run these harnesses (`npm run eval:harness`).
