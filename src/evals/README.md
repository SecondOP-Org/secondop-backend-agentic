# `src/evals/`

**What lives here:** Contract checks, critic/contract eval harnesses that enforce `AI_CONTRACT.md`, and the offline gold-set eval package (`gold/`) for ground-truth clinical scoring (SEC-205).

**What does not:** Production request handlers or live analysis orchestration.

**One rule:** If you change LLM output shape or medical guardrails, update and run these harnesses (`npm run eval:harness`). Gold-set work follows `docs/SEC-205-GOLD-SET-EVAL-HARNESS-SPEC.md` (`npm run eval:gold:fast -- --score-only` without API keys; live engines need `OPENAI_API_KEY`).
