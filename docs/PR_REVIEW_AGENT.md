# PR Review Agent Checklist

SEC-36 defines the repeatable AI PR review step that runs before human merge approval. The review agent helps the human decide whether a PR is ready, but it does not merge, deploy, approve production changes, rotate secrets, or sign off security-sensitive decisions.

## When It Runs

Run the PR review agent after:

- the coding agent has opened a draft PR and posted its PR-ready summary
- local checks have either passed or have documented environment blockers
- the Linear issue is in `In Review`
- the branch is pushed and reviewable in GitHub

Run it again when:

- code changes after review findings
- CI/check results change materially
- new review comments or requested changes appear
- the PR scope changes

Do not run it as a replacement for coding-agent self-review. The coding agent still owns implementation quality before PR creation.

## Review Inputs

The reviewer should inspect:

- Linear issue description and acceptance criteria
- PR title/body, linked issue, commits, and diff
- changed files and local architecture context
- tests/checks listed by the coding agent
- CI status when available
- relevant `AGENTS.md`, `AI_CONTRACT.md`, `SOUL.md`, and domain docs
- run ledger entries for the issue

## Severity Scale

Use clear severity labels:

- `P0`: must fix immediately; security/data loss/prod outage/legal/privacy risk
- `P1`: must fix before merge; likely user-visible bug, broken workflow, auth/data integrity risk, or failed acceptance criterion
- `P2`: should fix before merge; meaningful maintainability, test, UX, or edge-case risk
- `P3`: optional improvement; polish, clarity, or follow-up candidate

Only report findings that are actionable and grounded in evidence. Avoid speculative noise.

## Checklist

### Scope Discipline

- Does the PR match the Linear issue and acceptance criteria?
- Are unrelated refactors, formatting churn, generated files, or dependency changes avoided?
- Are repo-specific ledgers updated when files changed?
- Are follow-up items separated from this PR when they exceed scope?

### Architecture Fit

- Does the change follow existing repository patterns and module boundaries?
- Are controllers/components kept thin where the codebase expects that?
- Are reusable concerns placed in existing services/hooks/utilities instead of new ad hoc layers?
- Does the change respect `AI_CONTRACT.md` and medical traceability rules when AI/medical behavior is touched?

### Test Coverage

- Were the right checks run for the changed surface?
- Are tests added/updated for logic, permissions, API behavior, AI behavior, persistence, or reusable UI behavior?
- Are missing tests explained with credible risk assessment?
- Are environment/config failures clearly distinguished from code failures?

### Security And Privacy

- Are secrets, raw tokens, auth URLs, private env values, cookies, patient data, payment data, or sensitive logs absent from code, docs, reports, PR comments, and ledgers?
- Are new endpoints or UI routes protected by server-side authorization when needed?
- Are provider integrations least-privilege and server-side?
- Does the change avoid mutating production data without explicit approval?

### Frontend UX And Accessibility

Apply when frontend code changes:

- Does the UI follow existing design/component patterns?
- Are loading, error, empty, and partial-data states handled?
- Is access control real, not merely hidden navigation?
- Are labels, focus behavior, responsive layout, and visual hierarchy acceptable?

### Backend API And Data

Apply when backend code changes:

- Are request and response schemas validated?
- Are auth, role checks, data ownership, and audit logging adequate?
- Are database writes routed through audited services?
- Are migrations backward-compatible and safe to deploy?

### Deployment And Rollback

- Does the PR require deployment, migration, config, or provider changes?
- Is rollback obvious and documented when risk is non-trivial?
- Are production smoke checks non-mutating unless explicitly approved?
- Does the PR identify staging gaps if staging is unavailable?

## Output Template

Reviews must lead with findings. If there are no findings, say that clearly.

```md
## Findings

- [P1] Short actionable title
  File: `path/to/file.ts:123`
  Evidence: what is wrong and why it matters.
  Fix: concise recommended correction.

## Open Questions

- Question or assumption that affects merge safety.

## Test Gaps / Residual Risk

- What was not verified, and the likely impact.

## Summary

- Brief change summary only after findings.

## Recommendation

- `Request changes`, `Approve after fixes`, or `No blocking findings`.
```

For GitHub review comments, include file/line references where possible. For Linear, summarize only the high-signal findings, status, and next action.

## Reflection In GitHub And Linear

- Post actionable code findings as GitHub review comments when line-specific.
- Post a top-level PR review summary for cross-cutting findings and test gaps.
- Add a Linear comment with review outcome, blocker count, and required owner action.
- Move Linear status only when the workflow state changes; do not mark Done unless merged and closed.
- If the review requests changes, keep the issue in `In Review` and identify the coding agent follow-up.

## Guardrails

- The PR review agent does not merge or deploy.
- The PR review agent does not approve security-sensitive decisions alone.
- The PR review agent does not rotate secrets or change production config.
- The PR review agent must not expose secrets or raw private provider data in comments.
- The PR review agent should prefer concise, evidence-backed findings over broad commentary.
