# Local Command-Center Report

SEC-38 adds a local-only command-center report generator. It creates Markdown and JSON output in an ignored temp directory so operators can inspect workflow state without committing reports or exposing credentials.

## Generate A Report

From the backend repo:

```bash
npm run command-center:report
```

Default output:

```text
temp/command-center/command-center-report.md
temp/command-center/command-center-report.json
```

The default issue set is `SEC-38`, `SEC-39`, and `SEC-40`. To choose issues:

```bash
npm run command-center:report -- --issue SEC-38 --issue SEC-39
```

If the frontend repo is not a sibling of the backend repo, pass the workspace root:

```bash
npm run command-center:report -- --workspace-root /path/to/SecondOP-Agentic
```

## Optional Linear Snapshot

The generator does not require Linear credentials. To include Linear title, status, priority, project, assignee, labels, and attachments, pass a sanitized JSON snapshot:

```bash
npm run command-center:report -- --linear-snapshot temp/command-center/linear-sec-queue.json
```

Supported shape:

```json
{
  "issues": [
    {
      "id": "SEC-38",
      "title": "Build local command-center report generator",
      "url": "https://linear.app/secondop/issue/SEC-38/build-local-command-center-report-generator",
      "status": "In Progress",
      "priority": { "name": "High" },
      "assignee": "Vinodh P",
      "project": "Repository Agent Readiness",
      "labels": ["Observability", "Improvement"],
      "attachments": []
    }
  ]
}
```

When no snapshot is provided, the report still generates and records the missing Linear data as a blocker instead of failing.

## Optional Live Deployment Snapshot

Live provider checks are opt-in:

```bash
npm run command-center:report -- --live-deploys
```

This currently reads Railway service status through the local Railway CLI context. It must be run only from an authenticated operator machine. Missing CLI access is reported as unavailable data, not as a crash.

## Data Included

Each report includes:

- Linear issue and status when a snapshot is provided
- repo scope, branch, worktree, and git status
- PR link and review/check state when a PR is discoverable
- ledger check and deployment summaries
- latest matching sanitized ledger entry
- blockers and required human action
- optional Railway deployment/service snapshot

## Safety Rules

- Reports are written under ignored `temp/` output by default.
- Do not commit generated report files.
- Do not paste secrets, raw provider responses, auth URLs, private env values, cookies, patient data, payment data, or private logs into snapshots.
- The generator applies redaction for common token-shaped values, credential-bearing URLs, database URLs, and secret-like environment assignments.
- A generated local report is not an access-control boundary. Any future UI must use backend authorization and sanitized server-side data.
