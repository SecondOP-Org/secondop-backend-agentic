# Agent Run Ledger

This ledger is the durable audit trail for agent-assisted work in the SecondOp backend repository. It is intentionally file-first so it is visible in GitHub reviews and does not depend on chat history or local machine state.

## Ledger Rules

- Add one entry for each agent run that touches this repository.
- Keep entries concise, factual, and sanitized.
- Do not record secrets, tokens, OTPs, credentials, raw auth URLs, private environment values, patient data, or sensitive logs.
- Record blockers honestly, including environment, permission, CI, deployment, migration, database, or approval blockers.
- Link Linear issues and GitHub PRs when available.
- If a run spans multiple repositories, summarize the backend portion here and reference related frontend/root work.

## Entry Template

```md
## YYYY-MM-DD - SEC-000 - Short title

- Status:
- Human approval:
- Branch/worktree:
- Files changed:
- PR:
- Checks:
- Deployment:
- Verification:
- Blockers:
- Follow-ups:
```

## 2026-06-23 - SEC-33 - Add backend agent run ledger

- Status: In progress.
- Human approval: User requested backend parity with the frontend run ledger.
- Branch/worktree: `sec-33-add-backend-agent-run-ledger`, `.worktrees/sec-33-backend`.
- Files changed: `AGENTS.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: Pending.
- Checks: Pending.
- Deployment: None.
- Verification: Confirmed the backend main checkout is dirty, so work was isolated in a clean worktree from `origin/main`.
- Blockers: None.
- Follow-ups: Keep backend ledger updated for every backend agent run.

## 2026-06-23 - SEC-13 - Add backend request correlation IDs across logs and responses

- Status: Done.
- Human approval: User approved work and merge/deploy flow.
- Branch/worktree: `sec-13-add-backend-request-correlation-ids-across-logs-and`, `.worktrees/sec-13-backend`.
- Files changed: Backend request middleware/logging/response areas for request correlation ID propagation.
- PR: Merged before this ledger was introduced.
- Checks: Backend tests/build were run during the original task; see SEC-13 Linear comments and PR history for exact command output.
- Deployment: Included in backend production deployment ending at commit `af9f9d4`.
- Verification: Backend production `/health` returned 200 with `x-request-id` after deployment.
- Blockers: None recorded.
- Follow-ups: Use request IDs in support/debugging and future smoke checks.

## 2026-06-23 - SEC-10 - Require verifiable database SSL configuration for production

- Status: Done.
- Human approval: User approved work and merge/deploy flow.
- Branch/worktree: `sec-10-require-verifiable-database-ssl-configuration-for-production`, `.worktrees/sec-10-backend`.
- Files changed: Backend database SSL configuration path.
- PR: Merged before this ledger was introduced.
- Checks: Backend tests/build were run during the original task; see SEC-10 Linear comments and PR history for exact command output.
- Deployment: Included in backend production deployment ending at commit `af9f9d4`.
- Verification: Production backend health check passed after deployment.
- Blockers: None recorded.
- Follow-ups: Keep production database CA/SSL environment guidance sanitized and documented.

## 2026-06-23 - SEC-9 - Harden auth rate limiting and password reset token invalidation

- Status: Done.
- Human approval: User approved work and merge/deploy flow.
- Branch/worktree: `sec-9-harden-auth-rate-limiting-and-password-reset-token`, `.worktrees/sec-9-backend`.
- Files changed: Backend auth hardening areas for rate limiting and password reset token invalidation.
- PR: Merged before this ledger was introduced.
- Checks: Backend tests/build were run during the original task; see SEC-9 Linear comments and PR history for exact command output.
- Deployment: Included in backend production deployment ending at commit `af9f9d4`.
- Verification: Production backend health check passed after deployment.
- Blockers: None recorded.
- Follow-ups: Continue auth/security review items from the Security & Reliability queue.

## 2026-06-17 - SEC-5 - Codify agent workflow in AGENTS.md

- Status: Done.
- Human approval: User approved adding repo agent guides.
- Branch/worktree: `sec-5-backend`.
- Files changed: Backend `AGENTS.md`.
- PR: Merged before this ledger was introduced.
- Checks: Documentation-only workflow change; see SEC-5 Linear comments and PR history for exact verification.
- Deployment: Not applicable.
- Verification: Backend `AGENTS.md` became available in the repository.
- Blockers: None recorded.
- Follow-ups: SEC-27 and SEC-33 further refined agent workflow and ledger requirements.
