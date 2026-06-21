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
2. Inspect the repository before editing.
3. Summarize:
   - Problem
   - Acceptance criteria
   - Relevant files
   - Proposed implementation plan
   - Test plan
   - Risks or unknowns
4. Stop and wait for user approval before making code changes unless the user explicitly says `proceed`.
5. After approval, create a dedicated branch/worktree named from the Linear issue key and short title.
6. Implement the smallest correct change.
7. Follow existing architecture, naming, patterns, and coding style.
8. Avoid unrelated cleanup or broad refactors.
9. Add or update tests when touching logic, permissions, API behavior, AI behavior, persistence, or reusable services.
10. Run the appropriate checks and explain any environment/config blockers.
11. Prepare a PR-ready summary.
12. Open a draft PR only when the user asks.

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
