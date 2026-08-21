---
name: secondop-feature-delivery
description: >-
  Implements a Linear issue end-to-end for SecondOp: branch, code, tests, draft
  PR, and PR-ready summary. Use when implementing SEC-* issues, feature work,
  bug fixes, or when the user says implement, code, or open a PR.
---

# SecondOp Feature Delivery

Authoritative policy: this repo’s `AGENTS.md` (Required Task Workflow, Safety Rules, Software factory).

Principles: `SOUL.md` — smallest correct change, traceability, contract-first integration.

## Preconditions

- [ ] Linear issue is in `Todo` or `In Progress` (ready for code)
- [ ] A human moved product work to `Todo` (PM gate); do not do that yourself
- [ ] Issue is assigned to the prompting human and not In Progress for someone else
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
- [ ] 8. Update docs/AGENT_RUN_LEDGER.md (short entry at top of file)
- [ ] 9. Open draft PR; Linear handoff comment (issue, branch, PR, checks, risks, next human action)
- [ ] 10. Mark Linear `In Review`; post PR-ready summary
- [ ] 11. Stop — do not merge in this session. Later session / another human before merge/deploy
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
| Agentic runtime | `src/agentic/` |
| Case-analysis agents | `src/agents/case-analysis/` |
| Analysis services | `src/services/analysis*.ts` |

## Checks

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
- Do not merge PRs in the same session that wrote the code; wait for a later session and explicit approval
- Do not deploy, rotate secrets, or change production config without approval
- Do not expose secrets; use `.env.example` for env guidance only
