# 2026-07 — AI directory collapse blocked on shadow parity

**Status:** Blocked — human decision required  
**Linear:** [SEC-102](https://linear.app/secondop/issue/SEC-102/workspace-onboarding-phase-3-collapse-ai-dirs-blocked-on-shadow-parity)

## Decision gate

Compare `case_analysis_shadow_results` / agentic runs vs baseline orchestrator outputs. Only if parity is confirmed:

1. Promote agentic as the sole runtime
2. `git mv` into `src/ai/{orchestration,agents,tools,gateway}`
3. Delete `src/agents/core/agent.orchestrator.ts`
4. Import-only PR; all tests must pass with zero behavior change

If parity is **not** confirmed: keep Phases 1–2 docs only; leave three AI trees in place.

See `ARCHITECTURE.md` § “The two-orchestrator story”.
