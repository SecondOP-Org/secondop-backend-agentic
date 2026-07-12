---
name: secondop-linear-workflow
description: >-
  Creates, refines, and updates Linear issues for SecondOp. Use when creating a
  Linear ticket, writing or refining a spec, updating issue status, or preparing
  work before coding (SEC-*, Backlog, Todo, In Review, Done).
---

# SecondOp Linear Workflow

Authoritative policy: workspace root `AGENTS.md` (Source of Truth, Linear Status Mapping).

Principles: `SOUL.md` — safety over fluency, honest uncertainty, clinician authority.

## When to use

- User asks to create, spec, or refine a Linear issue
- Issue is not implementation-ready (missing acceptance criteria, test plan, etc.)
- Update Linear status after a workflow step (ready for code, ready for test, PR created)

## Spec template

Before marking ready for code, the issue should include:

```markdown
## Problem
[What is broken or missing, and for whom]

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Relevant files or areas
- `path/to/area`

## Proposed implementation plan
[Smallest correct approach]

## Test plan
[Commands and manual checks]

## Risks or unknowns
[Blockers, env deps, medical/safety concerns]
```

## Status mapping

| Status | Meaning | Agent action |
|--------|---------|--------------|
| `Backlog` / Spec Needed | Not ready | Refine spec; do not code |
| `Todo` / Ready for Code | Spec complete | Start implementation |
| `In Progress` | Coding/testing | Update as work proceeds |
| `Ready for Test` | Code complete | Run checks |
| `In Review` / PR Created | Draft PR open | Wait for human merge approval |
| `Done` | Merged | Deploy only if explicitly in scope |

## Workflow

1. Read the Linear issue (use Linear MCP when available).
2. If spec is incomplete, draft missing sections and post as a Linear comment or update description.
3. Mark `Todo` only when acceptance criteria and test plan are clear.
4. When opening a PR, add the PR link as a Linear comment.
5. Move to `In Review` when the draft PR is ready for human review.
6. Move to `Done` only after merge — not when coding finishes.

## Guardrails

- Linear defines requirements; GitHub defines code state.
- Do not mark `Done` for unmerged work.
- Do not merge, deploy, or change production config from this workflow.
