---
name: secondop-linear-workflow
description: >-
  Creates, refines, and updates Linear issues for SecondOp. Use when creating a
  Linear ticket, writing or refining a spec, updating issue status, or preparing
  work before coding (SEC-*, Backlog, Todo, In Review, Done).
---

# SecondOp Linear Workflow

Authoritative policy: this repo’s `AGENTS.md` (Source of Truth, Linear Status Mapping, Software factory).

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
| `Backlog` | Not ready / not yet selected | Refine spec; do not code. Dual name “Spec Needed” is an alias, not a column. |
| `Todo` | Spec complete, ready for code | Start implementation only after a **human** put product work here. Dual name “Ready for Code” is an alias for Todo. |
| `In Progress` | Coding/testing | Update as work proceeds. One In Progress issue per human unless another is blocked on CI/review. |
| `In Review` | Draft PR open | Wait for human merge approval (later session if solo). Dual name “PR Created” is an alias. |
| `Done` | Merged | Deploy only if explicitly in scope |

Do not add Linear statuses.

## Workflow

1. Read the Linear issue (use Linear MCP when available).
2. If spec is incomplete, draft missing sections and post as a Linear comment or update description. Create new product issues in **Backlog**.
3. **PM gate:** do **not** move product work Backlog → `Todo` unless a human did that (or the user explicitly authorized implementation). Bugs/chores that restore already-specified behavior may go to `Todo`.
4. Do not start coding unless the issue is `Todo` or `In Progress`, assigned to the prompting human, and not already In Progress for someone else.
5. When opening a PR, post a Linear **handoff** comment: issue key, branch, PR URL, checks, risks, next human action.
6. Move to `In Review` when the draft PR is ready for human review.
7. Move to `Done` only after merge — not when coding finishes.

## Guardrails

- Linear defines requirements; GitHub defines code state.
- Do not mark `Done` for unmerged work.
- Do not merge, deploy, or change production config from this workflow.
- Same-session self-merge is out of policy (see `AGENTS.md` solo merge pause).
