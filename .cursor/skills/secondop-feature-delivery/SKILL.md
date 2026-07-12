---
name: secondop-feature-delivery
description: >-
  Implements a Linear issue end-to-end for SecondOp: branch, code, tests, draft
  PR, and PR-ready summary. Use when implementing SEC-* issues, feature work,
  bug fixes, or when the user says implement, code, or open a PR.
---

# SecondOp Feature Delivery

Authoritative policy: workspace root `AGENTS.md` (Required Task Workflow, Safety Rules, Test Commands).

Stack-specific guides:
- Frontend: `secondop-fe-agentic/AGENTS.md`
- Backend: `secondop-backend-agentic/AGENTS.md`

Principles: `SOUL.md` — smallest correct change, traceability, contract-first integration.

## Preconditions

- [ ] Linear issue is in `Todo` (ready for code)
- [ ] Acceptance criteria are clear

If not ready, use `secondop-linear-workflow` first.

## Delivery checklist

```
- [ ] 1. Read Linear issue
- [ ] 2. Inspect repo; find existing patterns
- [ ] 3. Branch: <issue-key>-<short-title> (e.g. sec-123-analysis-ui)
- [ ] 4. Implement smallest correct change end-to-end
- [ ] 5. Add/update tests when touching logic, API, AI, permissions, or reusable UI
- [ ] 6. Architecture self-review (see below)
- [ ] 7. Run checks (see below)
- [ ] 8. Backend only: update docs/AGENT_RUN_LEDGER.md
- [ ] 9. Open draft PR; link in Linear
- [ ] 10. Mark Linear `In Review`; post PR-ready summary
- [ ] 11. Stop — wait for human approval before merge/deploy
```

## Architecture self-review

- Module boundaries preserved; controllers/components stay thin
- Domain logic in services/agents, not controllers
- No unrelated refactors or new dependencies without justification
- AI/medical changes comply with `AI_CONTRACT.md` — use `ai-contract-compliance` skill
- Medical content preserves source traceability

## Where code lives

| Area | Path |
|------|------|
| Agentic runtime | `secondop-backend-agentic/src/agentic/` |
| Case-analysis agents | `secondop-backend-agentic/src/agents/case-analysis/` |
| Analysis services | `secondop-backend-agentic/src/services/analysis*.ts` |
| Frontend components | `secondop-fe-agentic/src/components/` |
| Analysis types | `secondop-fe-agentic/src/types/analysis.ts` |

## Checks

**Frontend** (`secondop-fe-agentic`):
```bash
npm run lint
npm run build
```

**Backend** (`secondop-backend-agentic`):
```bash
npm run lint
npm test
npm run build
```

If AI/agentic code changed, also run `ai-contract-compliance` checks.

## PR-ready summary template

```markdown
## Linear issue
SEC-XXX — [title]

## What changed
[Brief description]

## Files changed
- `path/to/file`

## Tests run
[Commands]

## Test results
[Pass/fail; note env blockers separately from code failures]

## Risks
[Any merge/deploy/medical concerns]

## Follow-ups
[Out-of-scope items for future issues]
```

## Guardrails

- Do not push to `main`
- Do not merge PRs without explicit user approval
- Do not deploy, rotate secrets, or change production config without approval
- Do not expose secrets; use `.env.example` for env guidance only
