# SecondOp Backend Agent Guide

## Source of Truth
- Linear is the source of truth for product and task requirements.
- GitHub is the source of truth for code, branches, pull requests, and review state.
- `AI_CONTRACT.md` defines the required contract for AI outputs.
- Do not push to `main`.
- Do not merge pull requests.
- Do not deploy, rotate secrets, change production config, or modify security-sensitive areas without explicit approval.

## Required Task Workflow
1. Read the Linear issue provided by the user.
2. If the issue is not implementation-ready, create or refine the Linear spec before coding:
   - Problem
   - Acceptance criteria
   - Relevant files or areas
   - Proposed implementation plan
   - Test plan
   - Risks or unknowns
3. Mark the Linear issue as ready for code before starting implementation.
   - Current Linear mapping: use `Todo` for ready-for-code work.
4. Inspect the repository before editing.
5. Create a dedicated branch/worktree named from the Linear issue key and short title.
6. Implement the smallest correct change end to end.
7. Follow existing architecture, naming, patterns, and coding style.
8. Avoid unrelated cleanup or broad refactors.
9. Add or update tests when touching logic, permissions, API behavior, AI behavior, persistence, or reusable services.
10. Review the change against the broader architecture before opening a PR.
11. Mark the Linear issue as ready for test when coding is complete.
12. Run the appropriate checks and explain any environment/config blockers.
13. If checks fail, fix only relevant failures caused by the change and rerun checks.
14. Update the agent run ledger in `docs/AGENT_RUN_LEDGER.md`.
15. Open a draft PR when checks are complete and update Linear with the PR link.
16. Mark the Linear issue as PR created / needs merge approval.
   - Current Linear mapping: use `In Review` for PR-created work that needs human approval.
17. Prepare a PR-ready summary.
18. Stop and wait for human approval before merging, deploying, changing production config, rotating secrets, or taking destructive actions.
19. After human approval, merge according to repo policy, update Linear, and mark the issue `Done`.

## Linear Status Mapping
- `Backlog`: spec needed, blocked, or not yet selected.
- `Todo`: spec complete and ready for code.
- `In Progress`: actively coding or locally testing.
- `In Review`: PR created and needs human review/merge approval.
- `Done`: merged and closed; deployed only when deployment is explicitly in scope.

## Multi-Agent Workflow
- `docs/MULTI_AGENT_WORKFLOW.md` defines the shared Product/spec, Coding, PR review, QA/smoke-test, Release/deploy, and Command-center/status agent roles.
- `docs/COMMAND_CENTER_DESIGN.md` defines the command-center MVP, data sources, security boundaries, and future UI/API path.
- `docs/PR_REVIEW_AGENT.md` defines when the PR review agent runs, the review checklist, severity scale, output format, and GitHub/Linear reflection rules.
- Use that contract for handoffs between agents, especially when a task spans frontend, backend, PR review, QA, release, or command-center reporting.
- The human approval gates in this `AGENTS.md` remain authoritative for this repo: agents may prepare work through PR readiness, but must not merge, deploy, change production config, rotate secrets, take destructive actions, or sign off security-sensitive decisions without explicit human approval.

## Project Structure
- `src/server.ts`: Express and Socket.IO application entry point.
- `src/routes/`: API route definitions.
- `src/controllers/`: request handlers.
- `src/services/`: domain logic, orchestration helpers, and persistence-facing services.
- `src/database/`: database connection and query helpers.
- `src/middleware/`: auth, errors, uploads, rate limiting, and request middleware.
- `src/agentic/`: agentic runtime, planning, tools, observability, and orchestration.
- `src/agents/`: case-analysis agents and core agent interfaces.
- `src/ai/`: model registry and AI execution support.
- `migrations/`: PostgreSQL schema migrations.
- `scripts/`: database, smoke, and evaluation scripts.

## Coding Discipline
- Inspect existing code before editing.
- Keep changes scoped to the Linear issue.
- Do not modify unrelated files or clean up code outside the task.
- Prefer existing patterns, helpers, services, middleware, and architecture.
- Do not add new dependencies or create new libraries unless clearly justified and approved.
- Reuse current validation, logging, API, test, and styling conventions.
- Make the smallest correct change.
- Add tests when touching logic, API behavior, permissions, AI behavior, persistence, or reusable services.

## Agent Run Ledger
- `docs/AGENT_RUN_LEDGER.md` is the durable audit trail for agent work in this repository.
- Add or update a ledger entry for every task run that touches this backend repo.
- Keep entries concise and factual: Linear issue, branch/worktree, files changed, checks, PRs, deploys, approvals, blockers, and follow-ups.
- Never record secrets, raw tokens, private auth URLs, credentials, OTPs, environment values, patient data, or full sensitive logs.
- If a run is blocked before code changes, still add the blocker and next action when the branch includes documentation/workflow updates.
- If the task spans multiple repositories, reference the other repo and its issue/PR/deploy identifiers rather than duplicating private details.

## Run Locally
```bash
npm ci
cp .env.example .env
npm run db:setup
npm run dev
```

Database setup requires local PostgreSQL or Docker, depending on the script path used.

## Checks
```bash
npm run lint
npm test
npm run build
```

`npm run build` runs TypeScript compilation and acts as the backend typecheck.

## Architecture Rules
- Keep controllers thin: parse request, call service, return response.
- Put business logic in services, agents, or domain modules.
- Validate request payloads and AI payloads with strict schemas before use.
- AI outputs must comply with `AI_CONTRACT.md`.
- LLM tools must never read/write the database directly; persistence goes through audited services.
- Medical content must preserve traceability to source text/files when available.
- Use audited services for persistence and side effects.
- Do not add dependencies unless clearly justified.
- Do not edit generated or build output files.
- Do not expose or print secrets.
- Use `.env.example` only for environment guidance.

## PR-Ready Summary
- Linear issue
- What changed
- Files changed
- Tests run
- Test results
- Risks
- Follow-ups
