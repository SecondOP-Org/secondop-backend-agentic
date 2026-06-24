# Command-Center API Design

SEC-39 defines the backend API shape and authorization requirements for a future command-center UI. It is a design contract, not an implementation.

## Goals

- Aggregate workflow status for admins/operators from Linear, GitHub, Vercel, Railway, and sanitized run ledgers.
- Keep provider tokens, raw logs, private environment values, and operational secrets server-side.
- Give the frontend one safe API contract for command-center status.
- Preserve the SEC-38 local report generator as the offline/operator fallback.

## Non-Goals

- No frontend route in this ticket.
- No provider tokens or production credentials committed.
- No direct browser calls to Linear, GitHub, Vercel, Railway, or local ledgers.
- No patient, medical, payment, or production-user data in command-center responses.

## Current Auth Gap

The current backend auth middleware identifies users as `patient` or `doctor` only. A command-center API needs an explicit admin/operator authorization model before implementation.

Required future change:

- Add an admin/operator role or permission claim that is separate from `patient` and `doctor`.
- Enforce command-center access with `authenticate` plus a new server-side authorization guard such as `authorizeOperator`.
- Do not rely on hidden frontend routes, URL obscurity, or client-side role checks.
- Keep `DEV_SKIP_AUTH` disabled in production and never allow it to grant operator access in hosted environments.

## Proposed Endpoints

All endpoints live under `/api/v1/admin/command-center` and require admin/operator authorization.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/summary` | Status cards plus active/recent work items for the command-center dashboard. |
| `GET` | `/issues` | Normalized Linear issue queue with repo scope, phase, PR, checks, deploys, ledger, and human action. |
| `GET` | `/issues/:issueKey` | Detailed status for one Linear issue, including linked PR/deploy/ledger summaries. |
| `GET` | `/deployments` | Sanitized Vercel/Railway deployment status for configured projects/services. |
| `GET` | `/ledgers/latest` | Latest sanitized run ledger entries from allowed frontend/backend ledger sources. |

Future mutating operations, such as triggering a deploy or resolving a blocker, must be separate tickets and require explicit human approval.

## Response Schema

The API should return normalized data that mirrors the SEC-38 local report output and avoids raw provider payloads.

```ts
type CommandCenterSummaryResponse = {
  generatedAt: string;
  environment: "local" | "staging" | "production";
  cards: {
    needsHumanApproval: number;
    blocked: number;
    inFlight: number;
    recentlyDeployed: number;
    missingGuardrails: number;
  };
  items: CommandCenterItem[];
  providerStatus: ProviderStatus[];
  audit: {
    requestId: string;
    generatedByUserId: string;
    redactionVersion: string;
  };
};

type CommandCenterItem = {
  issue: {
    key: string;
    title: string;
    url: string;
    status: string;
    priority: "Urgent" | "High" | "Medium" | "Low" | "None" | "Unknown";
    assignee?: string;
    project?: string;
    labels: string[];
  };
  phase:
    | "spec_needed"
    | "ready_for_code"
    | "coding"
    | "checks"
    | "pr_review"
    | "merge_approval"
    | "deployed"
    | "blocked"
    | "done";
  repoScope: "frontend" | "backend" | "both" | "workflow_only" | "unknown";
  branch?: string;
  worktree?: string;
  pr?: {
    url: string;
    state: "draft" | "ready" | "merged" | "closed" | "unknown";
    mergeable?: "mergeable" | "conflicting" | "unknown";
    reviewDecision?: "approved" | "changes_requested" | "review_required" | "unknown";
    checks: CheckStatus[];
  };
  checks: CheckStatus[];
  deployment?: DeploymentStatus;
  ledger?: LedgerSummary;
  risks: string[];
  humanAction: string;
};
```

## Provider Integration Approach

Provider integrations must run server-side through least-privilege service credentials or server-owned OAuth apps.

| Provider | Server-side source | Minimum data | Safety requirements |
| --- | --- | --- | --- |
| Linear | Linear API/app integration | issue key, title, status, priority, project, labels, assignee, comments/links needed for workflow state | Store token outside repo; read-only scope by default; cache normalized fields only. |
| GitHub | GitHub App or fine-scoped token | PR URL, state, draft flag, mergeability, review decision, check conclusions, merge commit | Prefer GitHub App installation over personal token; never return raw token, raw webhook secret, or full private payload. |
| Vercel | Vercel API/team project integration | frontend deployment target, URL, status, commit SHA, created time | Do not expose Vercel tokens, env vars, build logs with secrets, or auth URLs. |
| Railway | Railway API/CLI-backed service integration | backend deployment ID, status, service URL, commit/source metadata, health status | Do not expose Railway token, service variables, DB URLs, or build logs with env values. |
| Run ledgers | Checked-in sanitized ledger files or generated report artifacts | latest issue-matching ledger entry, checks, deployment, blockers, follow-ups | Read allowlisted ledger paths only; never read arbitrary local paths from request input. |

## Sanitization Rules

Every provider adapter must normalize and sanitize before data leaves the backend boundary.

- Redact token-shaped values, bearer/basic auth headers, database URLs, webhook secrets, private env assignments, auth callback URLs, cookies, and OTPs.
- Drop raw provider payloads unless each field is allowlisted.
- Drop logs by default. If log summaries are needed, include only provider status, check names, timestamps, and sanitized error categories.
- Never include patient data, medical records, payment details, user messages, uploaded file names, or production customer identifiers.
- Truncate long text fields to a documented maximum and attach a `truncated: true` flag.
- Include `redactionVersion` in responses so future reports can identify the sanitizer used.

## Audit And Logging

Command-center API requests should be auditable because they expose operational metadata.

- Require request IDs and include `requestId` in responses.
- Log user ID, route, response status, provider adapters used, cache hit/miss, and duration.
- Do not log provider tokens, env values, raw API responses, patient data, or generated report bodies.
- Emit warnings for provider failures as categorized errors, such as `github_unavailable` or `railway_timeout`.
- Treat access-denied events as security-relevant logs.

## Error And Partial Data Model

The API should degrade like the SEC-38 local generator.

```ts
type ProviderStatus = {
  provider: "linear" | "github" | "vercel" | "railway" | "ledger";
  status: "available" | "partial" | "unavailable" | "skipped";
  message?: string;
  lastUpdatedAt?: string;
};
```

- Provider failures must not crash the entire summary.
- Responses should include partial rows and provider status warnings.
- The frontend must render partial-data states without revealing internal error payloads.

## Caching

Provider calls should be cached briefly to reduce API rate-limit risk.

- Default cache TTL: 30 to 120 seconds for summary data.
- Manual refresh should be admin/operator-only and rate-limited.
- Cache keys must not include secrets or raw auth headers.

## Implementation Test Plan

Before implementation is merged, add tests for:

- Unauthenticated requests return `401`.
- Authenticated non-operator users return `403`.
- Operator users can read summary responses.
- Response schema excludes known secret patterns and raw provider payloads.
- Provider adapter failure returns partial data plus provider warning.
- Ledger reads are restricted to allowlisted paths.
- Audit logging records request ID/user/provider status but not secrets.

## Open Implementation Decisions

- Exact admin/operator persistence model: new `user_type`, separate `roles` table, or permission claims.
- Whether provider data is fetched live per request or refreshed by a scheduled background job.
- Whether SEC-38 generated JSON becomes an import source for local/offline deployments.
- Whether production command-center access should require additional step-up auth.
