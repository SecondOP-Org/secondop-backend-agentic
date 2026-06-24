# Command Center Design

This document defines the MVP command-center concept for SecondOp engineering workflow visibility. It is a design artifact, not an app implementation.

## Problem

Project status currently lives across Linear, GitHub, Vercel, Railway, chat history, and repo run ledgers. The human operator needs one view that answers:

- What is being worked on?
- What is blocked?
- What is ready for human review or merge approval?
- What passed checks?
- What deployed, and to which target?
- What did the latest agent run record?

## MVP Decision

Start with a local generated report, not a hidden frontend admin page.

Reasons:

- A static hidden frontend route is not access control.
- Live Linear/GitHub/Vercel/Railway integrations require tokens or OAuth scopes that should not be bundled into the client.
- A local report can safely read sanitized repo ledgers and live tool/CLI output from an operator machine.
- The report can later become the data model for a protected admin UI once backend role enforcement and server-side integrations are designed.

The MVP output should be a generated Markdown or JSON+Markdown report committed nowhere by default, for example:

- `tmp/command-center-report.md`
- `tmp/command-center-report.json`

## Display Model

The command center should show one row per active work item or recently completed release.

Required fields:

| Field | Description |
| --- | --- |
| Linear issue | Issue key, title, URL, priority, assignee, project, and status. |
| Current phase | Spec needed, ready for code, coding, checks, PR review, merge approval, deployed, blocked, or done. |
| Repository scope | Frontend, backend, both, or workflow-only. |
| Branch/worktree | Branch name and local worktree path when available. |
| PR state | PR URL, draft/ready state, mergeability, review state, and required human action. |
| Checks | Lint, typecheck/build, unit/integration tests, CI checks, preview checks, and known missing checks. |
| Deployment | Target environment, provider, deployment URL/ID, status, source commit, and whether deployment was automatic or manual. |
| Run ledger | Latest relevant ledger entry path and summary. |
| Risks | Open blockers, environment issues, security/privacy flags, and test gaps. |
| Human action | The next decision needed from a human, if any. |

## Status Cards

In addition to rows, the report should summarize:

- Needs human approval: PRs ready for merge or deploy approval.
- Blocked: issues with failed checks, missing access, environment problems, or unresolved review findings.
- In flight: coding/testing work not yet ready for PR.
- Recently deployed: production/staging deploys with commit and target.
- Missing guardrails: known gaps such as backend CI not configured.

## Data Sources

| Source | Data needed | Access pattern | Auth/safety notes |
| --- | --- | --- | --- |
| Linear | Issue title, URL, priority, project, labels, assignee, status, comments. | Linear connector or API from operator context. | Do not store raw tokens in repo or report. |
| GitHub | PR URLs, branch, mergeability, review state, CI checks, merge commits. | GitHub connector or `gh` CLI from operator context. | Use least-privilege repo access. Do not print private tokens. |
| Vercel | Frontend preview/production deployment URL, target, status, commit SHA. | Vercel CLI/API from operator context. | Never commit Vercel tokens or project secrets. |
| Railway | Backend deployment status, service health, commit/deployment ID. | Railway CLI/API from operator context. | Never expose Railway tokens or env values. |
| Run ledgers | Latest sanitized entries from `docs/AGENT_RUN_LEDGER.md`. | Local file read from frontend/backend repos. | Ledgers must remain sanitized and must not include secrets or patient data. |
| Local git | Worktree status, branch, diff, local blockers. | Local `git` commands. | Report only paths/status, not secret file contents. |

## Security And Privacy Rules

- Do not expose secrets, tokens, OTPs, private auth URLs, private env values, cookies, or raw provider responses that may contain credentials.
- Do not show patient, medical, payment, or production user data.
- Do not put live API credentials into frontend code.
- Do not make the command center available to regular users.
- A future web UI must be server-backed, authenticated, and admin/ops-gated.
- Production smoke checks must be non-mutating unless explicitly approved.

## Local Report Generation Plan

1. Read active Linear issues in selected states: `Todo`, `In Progress`, `In Review`, and recent `Done`.
2. Resolve repo scope from labels, issue text, branch names, PR links, and ledger references.
3. Read GitHub PR state and checks for linked PRs.
4. Read Vercel/Railway deployment state only when a PR is merged or deployment is in scope.
5. Parse the latest matching ledger entries from frontend and backend `docs/AGENT_RUN_LEDGER.md`.
6. Generate a Markdown summary for humans and an optional JSON file for future UI use.
7. Record the command-center run in the relevant ledger if it touches repo files or produces committed output.

## Future Protected UI Plan

A hidden/admin frontend page should wait until these are true:

- Backend exposes a server-side command-center API.
- The API fetches or receives sanitized status data server-side.
- Auth identifies an admin/operator role.
- The frontend route is protected by real role checks, not obscurity.
- The API response excludes secrets, private env values, and sensitive user data.

## Follow-Up Implementation Tickets

- SEC-38: Build a local command-center report generator that outputs Markdown and JSON from Linear, GitHub, Vercel/Railway metadata, and run ledgers.
- SEC-39: Design a backend command-center API with server-side provider integrations and admin-only authorization.
- SEC-40: Build a protected frontend admin command-center page backed by the API.
- Add command-center smoke checks to the QA/release workflow after SEC-36 and SEC-37 define review and QA templates.
