---
name: secondop-pr-lifecycle
description: >-
  Reviews SecondOp pull requests, posts findings, and prepares merge after human
  approval. Use when reviewing a PR, PR review, merge approval, request changes,
  or checking if a branch is merge-ready.
---

# SecondOp PR Lifecycle

Authoritative checklist: `docs/PR_REVIEW_AGENT.md`.

Policy: workspace root `AGENTS.md` (Safety Rules — do not merge without explicit approval).

Principles: `SOUL.md` — evidence-backed, honest uncertainty.

## When to run review

Run after:
- Coding agent opened a draft PR with PR-ready summary
- Local checks passed or blockers are documented
- Linear issue is `In Review`
- Branch is pushed and reviewable on GitHub

Re-run when code, CI, or review comments change materially.

## Review inputs

- Linear issue + acceptance criteria
- PR title/body, commits, diff
- CI status when available
- `AGENTS.md`, `AI_CONTRACT.md`, `SOUL.md` when AI/medical behavior touched
- Backend: `docs/AGENT_RUN_LEDGER.md` entry for the issue

## Severity scale

| Label | Meaning |
|-------|---------|
| `P0` | Security, data loss, prod outage, legal/privacy — fix immediately |
| `P1` | Must fix before merge; broken workflow or failed acceptance criterion |
| `P2` | Should fix before merge; maintainability, tests, UX edge cases |
| `P3` | Optional polish or follow-up |

Only report actionable, evidence-backed findings.

## Output template

```markdown
## Findings

- [P1] Short actionable title
  File: `path/to/file.ts:123`
  Evidence: what is wrong and why it matters.
  Fix: concise recommended correction.

## Open Questions

- Assumption affecting merge safety.

## Test Gaps / Residual Risk

- What was not verified and likely impact.

## Summary

- Brief change summary (after findings).

## Recommendation

- `Request changes`, `Approve after fixes`, or `No blocking findings`.
```

## Reflection

- Line-specific findings → GitHub review comments
- Cross-cutting summary → PR top-level comment
- High-signal outcome → Linear comment (blocker count, next action)
- Keep issue `In Review` until merged; do not mark `Done` prematurely

## Merge (only after explicit human approval)

When the user explicitly approves merge:

1. Confirm CI green or blockers accepted
2. Merge per repo policy (do not force-push `main`)
3. Update Linear with merge note
4. Mark issue `Done`
5. Deploy only if user explicitly requests — use `secondop-deploy` skill

## Guardrails

- Review agent does not merge or deploy on its own
- Do not approve security-sensitive decisions alone
- Do not expose secrets in PR comments or Linear updates

## Additional detail

For the full checklist (scope, architecture, security, frontend UX, backend API, deployment), see [reference.md](reference.md).
