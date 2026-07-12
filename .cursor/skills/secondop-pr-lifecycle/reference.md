# PR Review Checklist (condensed from PR_REVIEW_AGENT.md)

## Scope discipline

- PR matches Linear issue and acceptance criteria
- No unrelated refactors, formatting churn, or unjustified dependencies
- Ledgers updated when required (backend: `docs/AGENT_RUN_LEDGER.md`)
- Follow-ups split to separate issues when out of scope

## Architecture fit

- Follows existing patterns and module boundaries
- Controllers/components thin; logic in services/hooks/agents
- `AI_CONTRACT.md` and traceability rules respected for AI/medical changes

## Test coverage

- Right checks run for changed surface
- Tests added/updated for logic, permissions, API, AI, persistence, reusable UI
- Env/config failures distinguished from code failures

## Security and privacy

- No secrets, tokens, patient data, or sensitive logs in code/docs/PR/ledger
- New endpoints/routes protected by server-side auth when needed
- No production data mutation without explicit approval

## Frontend (when FE changes)

- Existing design/component patterns
- Loading, error, empty, partial-data states
- Access control is real, not hidden nav only

## Backend (when BE changes)

- Request/response schemas validated
- Auth, ownership, audit logging adequate
- DB writes through audited services
- Migrations backward-compatible and deploy-safe

## Deployment and rollback

- Migration, config, or provider changes identified
- Rollback path documented when risk is non-trivial
- Staging gaps called out if staging unavailable
