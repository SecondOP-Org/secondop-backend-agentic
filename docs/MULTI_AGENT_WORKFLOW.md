# Multi-Agent Engineering Workflow

This document defines how SecondOp uses multiple AI-assisted roles while keeping Linear as the source of truth for requirements and GitHub as the source of truth for code, pull requests, and review state.

The goal is not to add ceremony. The goal is to make handoffs explicit, keep human approval at the right gates, and preserve a durable audit trail in Linear, GitHub, and `docs/AGENT_RUN_LEDGER.md`.

## Roles

| Role | Purpose | May do autonomously | Requires human approval |
| --- | --- | --- | --- |
| Product/spec agent | Turn a human requirement into a Linear-ready task. | Create or refine Linear specs, acceptance criteria, risks, test plans, labels, and priority suggestions. | Final product direction when requirements are ambiguous or materially change scope. |
| Coding agent | Implement the smallest correct change for an approved Linear issue. | Inspect code, create a dedicated branch/worktree, edit files, add tests, run checks, update the run ledger, push a branch, and open/update a draft PR. | Merge, deploy, production config, secrets, destructive actions, or security-sensitive sign-off. |
| PR review agent | Review a PR for correctness, risks, regressions, test gaps, and architecture fit. | Read PR diff/checks, leave review findings, recommend fixes, and update Linear with review status. | Approving merge on behalf of a human, dismissing required reviews, or resolving product/security disagreements alone. |
| QA/smoke-test agent | Verify local, preview, staging, or production behavior with a defined checklist. | Run non-destructive checks, browser verification, API health checks, and record evidence. | Tests that mutate production data, use sensitive accounts, bypass auth, or affect real users. |
| Release/deploy agent | Coordinate merge, deployment, verification, rollback readiness, and release notes. | Prepare release plan, inspect CI/deployment status, verify deployment metadata, and document rollback path. | Merging, production deployment, rollback, production config changes, or secret rotation. |
| Command-center/status agent | Maintain the operational view of active work. | Summarize Linear/PR/check/deploy/ledger state and identify blocked or approval-needed items. | Changing product priority, approving merge/deploy, or overriding a failing gate. |

## Default Flow

1. Human gives a requirement.
2. Product/spec agent records or refines the Linear issue.
3. Linear issue moves to `Todo` when the spec is ready for code.
4. Coding agent moves the issue to `In Progress`, creates a dedicated branch/worktree, implements the change, runs checks, updates the run ledger, and opens or updates a draft PR.
5. PR review agent reviews the PR and records findings or a clean review summary.
6. QA/smoke-test agent runs the relevant non-destructive verification and records evidence.
7. Coding agent addresses findings caused by the change.
8. Issue moves to `In Review` when the PR is ready for human merge approval.
9. Human approves or rejects merge and any deploy.
10. Release/deploy agent performs only the approved merge/deploy actions and records evidence.
11. Command-center/status agent summarizes final state and ensures Linear, GitHub, and the run ledger agree.

## Handoff Contract

Every handoff should include enough context for the next role to proceed without rereading the full conversation.

Required handoff fields:

- Linear issue key, title, status, priority, and URL.
- Repository, branch, worktree, and PR URL if present.
- Scope summary and files changed.
- Acceptance criteria status.
- Checks run and exact results.
- Review findings, open risks, or known test gaps.
- Deployment target and deploy evidence when deployment is in scope.
- Run ledger entry location or summary.
- Required human action, if any.

## Human Approval Gates

Agents must stop for explicit human approval before:

- Merging a PR.
- Deploying to production or triggering rollback.
- Changing production configuration.
- Rotating, viewing, or modifying secrets.
- Running destructive commands or data migrations against shared environments.
- Mutating production data or sending sensitive user, patient, auth, payment, or private operational data to an external service.
- Accepting a security-sensitive risk or signing off a security control.

## Conflict Rules

- If checks fail, the coding agent fixes only failures caused by the current change and reruns the relevant checks.
- If failures are unrelated or environment-caused, record evidence in Linear, the PR, and the run ledger instead of broad cleanup.
- If agents disagree, the safest status wins: keep the issue out of `Done`, keep the PR unmerged, and ask for human decision with evidence.
- If product scope changes during implementation, return to Linear spec update before continuing.
- If a PR review finds security, privacy, data-loss, auth, medical traceability, or production-risk concerns, treat them as human-review blockers unless clearly resolved in code and tests.
- If deployment verification contradicts GitHub/Vercel/Railway state, keep the release open and record both signals.

## Where This Workflow Lives

- Repo-specific rules live in each repo's `AGENTS.md`.
- This multi-agent contract lives in `docs/MULTI_AGENT_WORKFLOW.md`.
- Run history lives in `docs/AGENT_RUN_LEDGER.md`.
- Product/task truth lives in Linear.
- Code, PR, review, and CI truth lives in GitHub.

If these sources disagree, update the durable source rather than relying on chat history.
