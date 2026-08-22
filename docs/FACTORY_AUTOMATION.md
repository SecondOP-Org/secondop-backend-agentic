# Software Factory Automation (SEC-236)

This document describes the automation glue that turns the documented multi-agent
workflow (`docs/MULTI_AGENT_WORKFLOW.md`) into a self-running line. It closes the
three gaps that were previously "documented but manual": autonomous dispatch,
automated PR review, and release automation.

All three respect the human approval gates in `AGENTS.md`. None of them merge,
deploy, change production config, rotate secrets, or run destructive commands.

## 1. Autonomous dispatch — `scripts/dispatch.mjs`

Selects issues that are ready for code (`Todo`) from a sanitized Linear snapshot
(the same JSON shape `scripts/command-center-report.mjs` consumes) and, for each,
prepares an isolated git worktree + branch + a coding handoff brief. It stops at
the human gates — it never merges or deploys.

```bash
# Prepare a worktree + brief for a specific issue (no agent invoked)
npm run factory:dispatch -- --issue SEC-241 --title "short title"

# Pull all ready-for-code issues from a Linear snapshot, one at a time
npm run factory:dispatch -- --linear-snapshot snapshot.json --status Todo --limit 1

# Hand off to a pluggable coding agent after prep
SECONDOP_CODING_AGENT_CMD="cursor-agent run" npm run factory:dispatch -- --issue SEC-241 --run
```

The coding agent is intentionally pluggable via `SECONDOP_CODING_AGENT_CMD`
(receives the handoff-brief path as its final argument). Without it, dispatch runs
in plan mode: the workspace and brief are ready for a human or interactive agent
(Cursor/Claude) to take over. Output plan: `temp/dispatch/dispatch-plan.json`.

## 2. Automated PR review — `scripts/pr-review.mjs` + `.github/workflows/pr-review.yml`

Runs on every PR (`opened`/`synchronize`/`reopened`/`ready_for_review`). It gathers
the review context from `docs/PR_REVIEW_AGENT.md` (diff, changed files, severity
scale) and upserts a single review comment on the PR.

- With `SECONDOP_REVIEW_CMD` (a model command, e.g. Claude Code) set as an Actions
  secret, that command produces the review body.
- Without it, a deterministic, grounded checklist scaffold is posted so the step is
  always actionable.

The review never approves merge, dismisses required reviews, deploys, or resolves
security/product decisions — those stay human-gated. Locally:

```bash
npm run factory:pr-review -- --base origin/main --head HEAD --out pr-review.md
```

## 3. Release automation — `scripts/release.mjs`

Implements the mechanical parts of `docs/RELEASE_VERSIONING.md`:

```bash
# Preview the next version + CHANGELOG section
npm run factory:release -- --bump minor

# Write the CHANGELOG section, then create a local (unpushed) tag
npm run factory:release -- --bump minor --write --tag

# Emit build metadata for the /version endpoint (KEY=VALUE lines)
npm run factory:release -- --print-metadata
```

The changelog is generated from Conventional-Commit history since the last tag.
Tagging is off by default and `--tag` only creates a **local** tag; pushing a tag
and deploying remain explicit human actions.

### Wiring `/version` build metadata

The runtime `/version` endpoint (`src/config/releaseMetadata.ts`) already reads
`SECONDOP_RELEASE_VERSION`, `BACKEND_GIT_SHA`, `BACKEND_BUILD_TIME`, and
`BACKEND_DEPLOYMENT_ID` from the environment. To make `/version` report the real
release instead of `unknown`, inject them at deploy time. In a CI/deploy step:

```bash
node scripts/release.mjs --print-metadata >> "$GITHUB_ENV"
# then pass SECONDOP_RELEASE_VERSION etc. through to the Railway service env
```

On Railway, set `SECONDOP_RELEASE_VERSION` on the service; the platform already
provides `RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_DEPLOYMENT_CREATED_AT`, and
`RAILWAY_DEPLOYMENT_ID`, which `releaseMetadata.ts` reads as fallbacks.

## Frontend parity

`secondop-fe-agentic` carries the same governance docs (`AGENTS.md`,
`MULTI_AGENT_WORKFLOW.md`, `PR_REVIEW_AGENT.md`, `COMMAND_CENTER_DESIGN.md`,
`RELEASE_VERSIONING.md`, run ledger) and its own `frontend-ci.yml`. To reach full
factory parity it should mirror the PR-review workflow and expose the same
`/version`-style build metadata; dispatch is workspace-level and already resolves
both repos from the shared workspace root.
