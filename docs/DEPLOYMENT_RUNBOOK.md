# SecondOp Full-Stack Deployment Runbook (Frontend + Backend)

This runbook deploys:
- Frontend (`secondop-fe-agentic`) to Vercel
- Backend (`secondop-backend-agentic`) to Railway

It is written for the current repo scripts and env keys.

**Authority:** Never deploy, rotate secrets, or change production config without **explicit human approval**.

## 0) Release decision paths (SEC-26)

### Normal path (default)

```text
PR merged → CI green → Railway staging + migrations → staging smoke
  → human production approval → Railway production + migrations
  → Vercel production → production smoke → Linear/GitHub status update
```

Use this whenever Railway staging (`secondop-backend-staging`) and a usable Vercel preview (or staging FE) are available. Staging was provisioned in SEC-18; prefer it for every routine release.

### Direct-to-production exception (staging unavailable)

Allowed **only** when all of the following are true:

1. Staging cannot be used (service down, DB unavailable, SSO-blocked preview with no alternate check, or human declares an emergency hotfix).
2. A human explicitly approves **direct-to-production** in chat/Linear (not implied by “deploy”).
3. The releaser records a short **risk note** (what is shipping, why staging was skipped, blast radius).
4. **Rollback readiness** is confirmed before deploy (previous Railway deployment id + previous Vercel production deployment identified).
5. **Post-deploy smoke evidence** is captured and posted (health/version, FE load, one critical path).

Dry-run reference: 2026-06-23 release skipped staging by user instruction and went straight to production — that pattern is the exception path, not the default.

Exception checklist (copy into Linear comment before deploy):

```md
## Direct-to-prod exception
- Human approval: @name / quote
- Why staging skipped:
- Risk note:
- Rollback ready: Railway prior deploy ___ ; Vercel prior deploy ___
- Post-deploy smoke evidence: (fill after)
```

After the exception release, restore the normal staging path as soon as staging is healthy again.


- Frontend: `secondop-fe-agentic`
- Backend: `secondop-backend-agentic`

From workspace root:

```bash
cd /Users/10D/Documents/Vinodh/10D/Code/SecondOp/SecondOP-Agentic
```

## 2) One-Time Platform Setup

1. Create Railway services/environments:
- `secondop-backend-staging`
- `secondop-backend-production`

2. Create Vercel projects/environments:
- Preview (branches/PRs)
- Production (main branch)

3. Provision PostgreSQL for each backend environment.

Current staging setup:
- Railway environment: `staging`
- Railway backend service: `secondop-backend-staging`
- Railway staging Postgres service: `Postgres-k0Us`
- Backend staging URL: `https://secondop-backend-staging-staging.up.railway.app`
- Vercel frontend preview URL verified for SEC-18: `https://secondop-frontend-kins2bi6w-vinodhs-projects-0f6d26b0.vercel.app`

Note: Vercel Preview deployments may be protected by Vercel SSO. In that case, unauthenticated browser/curl access returns 302 to Vercel SSO. Use `vercel inspect <preview-url> --scope vinodhs-projects-0f6d26b0` to verify deployment readiness.

## 3) Backend Environment Variables (Railway)

Set these in both staging and production (with environment-specific values):

```env
NODE_ENV=production
PORT=5000
API_VERSION=v1

DB_HOST=
DB_PORT=5432
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_SSL=true

JWT_SECRET=
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_ROUNDS=12

CORS_ORIGIN=https://<your-frontend-domain>
SOCKET_IO_CORS_ORIGIN=https://<your-frontend-domain>

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=60000
ANALYSIS_AGENTIC_MODE=direct
AGENTIC_MODEL=gpt-4.1-mini
AGENTIC_MAX_STEPS=8
AGENTIC_MAX_REFINEMENTS=1
AGENTIC_MAX_WALL_CLOCK_MS=120000
AGENTIC_MAX_TOTAL_TOKENS=40000
AGENTIC_MAX_ESTIMATED_COST_USD=0.25
AGENTIC_RUNTIME=native
AGENTIC_LANGCHAIN_ALLOW_FALLBACK=true

STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

MAX_FILE_SIZE=52428800
UPLOAD_DIR=/data/uploads
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
LOG_LEVEL=info
ANALYSIS_QUEUE_NAME=case-analysis-baseline
ANALYSIS_QUEUE_SCHEMA=pgboss
```

Notes:
- Keep `DEV_SKIP_AUTH=false` in hosted environments.
- **Production file storage:** mount a Railway Volume on the backend service at `/data/uploads` and set `UPLOAD_DIR=/data/uploads`. Without the volume, uploads use ephemeral container disk and are lost on redeploy. Requires a single backend replica with in-process analysis worker.

### Imaging / upload durability (SEC-181)

DICOM bytes live on the Railway volume under `UPLOAD_DIR`. Postgres keeps study/file metadata. If the volume is missing, remounted empty, or files are deleted outside the app, specialists see case records (PDF) while **Imaging** and analysis that depended on those files go blank.

**Prevention**
1. Confirm production `secondop-backend` has a volume mounted at `/data/uploads` (not ephemeral disk).
2. Keep a **single** backend replica while the analysis worker is in-process and storage is local-volume.
3. Never recreate the volume without a backup restore plan.
4. After every production deploy, spot-check a known case with imaging: View still opens; download study zip still works.

**Recovery when imaging is missing**
1. Check Railway volume still attached and `UPLOAD_DIR=/data/uploads`.
2. If volume was replaced: restore from backup if available; otherwise ask the patient/ops to **re-upload** the study.
3. FE shows an explicit “imaging unavailable” state when DICOM file metadata exists (or study rows exist) but no viewable instances — do not treat that as “never uploaded.”
4. Re-run analysis only after bytes are restored.
- `CORS_ORIGIN` supports comma-separated values; include preview + production URLs if needed.
- `ANALYSIS_AGENTIC_MODE=direct` makes the agentic runtime the only primary analysis flow.
- Backend analysis jobs now use `pg-boss` on Postgres (schema defaults to `pgboss`).
- Ensure DB user can create/use the `pgboss` schema and tables on first boot.

## 4) Frontend Environment Variables (Vercel)

### Preview

```env
VITE_APP_ENV=test
VITE_API_BASE_URL=https://secondop-backend-staging-staging.up.railway.app
VITE_API_VERSION=v1
VITE_ENABLE_MOCKS=false
VITE_ENABLE_DEMO_ACCESS=false
```

### Production

```env
VITE_APP_ENV=production
VITE_API_BASE_URL=https://<railway-production-domain>
VITE_API_VERSION=v1
VITE_ENABLE_MOCKS=false
VITE_ENABLE_DEMO_ACCESS=false
```

Notes:
- Frontend build throws if production build points to localhost for `VITE_API_BASE_URL`.
- SPA rewrites are already configured in `vercel.json` and `netlify.toml`.

## 4a) Release Version and Build Metadata

SecondOp uses one product release version for the whole product plus separate frontend/backend build metadata.

- Product release version: one SemVer value, for example `0.1.0`.
- Frontend build metadata: frontend commit SHA, Vercel deployment id or URL, build time, and environment.
- Backend build metadata: backend commit SHA, Railway deployment id or URL, build time, environment, and API version.
- API version remains separate from product version.
- `package.json` versions are package metadata only until release automation intentionally changes that policy.

The checked-in policy lives in each repo at:
- `secondop-fe-agentic/docs/RELEASE_VERSIONING.md`
- `secondop-backend-agentic/docs/RELEASE_VERSIONING.md`

Verify live builds with (implemented):
- Backend: `GET /version` — [SEC-22](https://linear.app/secondop/issue/SEC-22)
- Frontend: `window.__SECONDOP_BUILD__` — [SEC-23](https://linear.app/secondop/issue/SEC-23)
- Optional Vercel CLI/dashboard inspection path — [SEC-25](https://linear.app/secondop/issue/SEC-25) (Backlog)

## 5) Pre-Deploy Local Validation

Run these before pushing:

```bash
# Frontend
cd secondop-fe-agentic
npm ci
npm run lint
npm run build

# Backend
cd ../secondop-backend-agentic
npm ci
npm run lint
npm test
npm run build
```

## 6) Staging Deployment Order

**Normal path step.** Skip only under §0 direct-to-production exception.

1. Deploy backend to Railway staging.
2. Run backend migrations against staging DB:

```bash
cd secondop-backend-agentic
export PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD" PGDATABASE="$DB_NAME"
npm run db:migrate
```

3. Verify backend health:

```bash
curl https://secondop-backend-staging-staging.up.railway.app/health
```

Expected:
- HTTP 200
- JSON contains `"status":"ok"`

Verify backend release metadata:

```bash
curl https://secondop-backend-staging-staging.up.railway.app/version
```

Expected safe fields:
- `productVersion`
- `backendVersion`
- `gitSha`
- `buildTime`
- `environment`
- `apiVersion`
- `deploymentId`

4. Deploy frontend to Vercel preview with staging API URL.
5. Run smoke tests in preview:
- Login/register
- Create case
- Send message
- Upload file
- Billing route loads

Useful staging CORS check:

```bash
curl -I \
  -H "Origin: https://secondop-frontend-kins2bi6w-vinodhs-projects-0f6d26b0.vercel.app" \
  https://secondop-backend-staging-staging.up.railway.app/health
```

Expected:
- HTTP 200
- `access-control-allow-origin` equals the Vercel preview origin.

## 7) Production Deployment Order

**Normal path:** only after staging smoke tests are green **and** a human approves production.

**Exception path:** only after §0 exception checklist is filled and approved — then continue from step 2 below (no staging confirmation).

1. Confirm staging smoke tests are green (skip only for approved §0 exception).
2. Deploy backend to Railway production.
3. Run production DB migrations:

```bash
cd secondop-backend-agentic
export PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD" PGDATABASE="$DB_NAME"
npm run db:migrate
```

4. Verify production backend health:

```bash
curl https://<railway-production-domain>/health
```

Verify production backend release metadata:

```bash
curl https://<railway-production-domain>/version
```

Expected safe fields:
- `productVersion`
- `backendVersion`
- `gitSha`
- `buildTime`
- `environment`
- `apiVersion`
- `deploymentId`

5. Promote/deploy frontend to Vercel production.
6. Run production smoke tests end-to-end (same flow as staging).

Verify frontend release metadata:

1. Open the deployed frontend.
2. In the browser console, inspect:

```js
window.__SECONDOP_BUILD__
```

Expected safe fields:
- `productVersion`
- `frontendVersion`
- `gitSha`
- `buildTime`
- `environment`
- `vercelDeploymentId`
- `vercelUrl`

## 8) Rollback Plan

If release fails, roll back **frontend and/or backend independently**. Prefer rolling back the failing surface first; avoid new feature deploys until smoke is green again.

### 8.0 Before you need it (rollback readiness)

Record on the release Linear issue / PR before production deploy:

- Railway: previous successful production deployment id (or commit SHA) for `secondop-backend`
- Vercel: previous successful production deployment URL/id for `secondop-frontend`
- Confirm volume `/data/uploads` remains attached (do not “fix” imaging by recreating an empty volume)
- If the release includes a DB migration: know whether it is backward-compatible; if not, have a DB restore plan before migrate

### 8.1 Frontend rollback (Vercel)

1. Open Vercel project `secondop-frontend` → **Deployments**.
2. Find the last known-good **Production** deployment (pre-incident).
3. Use **Promote to Production** / redeploy that deployment (dashboard), **or** CLI when authenticated:

```bash
# Inspect current production
vercel ls --prod --scope <team>

# Redeploy a prior deployment id (example)
vercel rollback <deployment-url-or-id> --scope <team>
```

4. Verify `https://secondop.ai` returns 200 and:

```js
window.__SECONDOP_BUILD__
```

matches the rolled-back commit/deployment.

### 8.2 Backend rollback (Railway)

1. Open Railway project → service `secondop-backend` (production) → **Deployments**.
2. Redeploy the previous successful deployment (dashboard), **or** redeploy a known-good git SHA from source with human approval.
3. Verify:

```bash
curl https://<railway-production-domain>/health
curl https://<railway-production-domain>/version
```

Expect HTTP 200, `"status":"ok"`, and `gitSha` matching the rolled-back build.

4. **Schema / migration failure:** do **not** leave a half-applied migration. Restore Postgres from the pre-migrate snapshot/backup, then redeploy the prior backend build. Do not invent forward “fix” migrations under incident pressure without human approval.

5. **Upload volume:** never detach/recreate `/data/uploads` as a rollback step — that deletes DICOM/PDF bytes (see § Imaging / upload durability).

### 8.3 Temporary safety (AI)

- Set `ANALYSIS_AGENTIC_MODE=off` or `shadow` if analysis causes regressions (human approval required for production env changes).

## 8a) Phoenix tracing (production)

Optional OTEL UI for analysis spans. Postgres `/analysis/trace` remains the audit source of truth.

- UI: https://secondop-phoenix-production.up.railway.app  
- Railway services: `secondop-phoenix` (+ dedicated Postgres for Phoenix data)  
- Backend env: `PHOENIX_ENABLED`, `PHOENIX_COLLECTOR_URL`, `PHOENIX_PROJECT_NAME`, `PHOENIX_API_KEY`  
- Operator guide: `secondop-backend-agentic/docs/PHOENIX_TRACING.md`  
- Treat Phoenix as a sensitive ops surface (span attributes may include case/run metadata).

## 8b) Service Health dashboard (operator)

Operator-only UI to see staging + production surfaces as up/down.

- FE routes (bookmark; not in patient/doctor sidebar):
  - `/admin/service-health`
  - `/admin/command-center`
- API: `GET /api/v1/admin/service-health` (same allowlist as Command Center)
- Auth: `COMMAND_CENTER_OPERATOR_EMAILS` / `COMMAND_CENTER_OPERATOR_USER_IDS` on the backend
- Optional catalog: `SERVICE_HEALTH_TARGETS` JSON on Railway backend (staging + production). When unset, built-in production defaults + staging backend URL are used.
- Optional: `SECONDOP_DEPLOY_ENV=production|staging` to label local dependency checks

Probe types in `SERVICE_HEALTH_TARGETS`:
- `http` — GET URL (2xx/3xx up; SSO/login redirect → degraded)
- `backend_health` — GET `{url}/health` expects `{ "status": "ok" }`
- `presidio_health` — GET `{url}/health`

After merging SEC-105, set Railway variables on `secondop-backend` (production) and `secondop-backend-staging` if you need custom staging FE / Presidio URLs. Defaults already cover production FE, API, Presidio, Phoenix, and staging API.

## 8c) Presidio text de-id (SEC-104)

When `DEID_ENABLED=true`, set real Presidio URLs on the backend — never rely on localhost defaults on Railway.

| Variable | Notes |
|----------|--------|
| `DEID_ENABLED` | `true` in staging/production when sidecars are up |
| `DEID_REVERSIBLE_KEY` | Required when enabled |
| `PRESIDIO_ANALYZER_URL` / `PRESIDIO_ANONYMIZER_URL` | Staging may use `*.railway.internal`; production currently uses public `*.up.railway.app` |
| `PRESIDIO_MIN_SCORE` / `PRESIDIO_TIMEOUT_MS` | Tuning |

Railway services: `secondop-presidio-analyzer` (+ `-staging`), `secondop-presidio-anonymizer` (+ `-staging`).

Verify: `GET {PRESIDIO_*_URL}/health` and authenticated `GET /api/v1/presidio/status`. Detail: `secondop-backend-agentic/docs/PRESIDIO_PRODUCTION.md`.

## 8d) Presidio image-redactor (pixel PHI — SEC-129/SEC-130)

Burned-in pixel redaction for report photos and US/SC/XC/OT DICOM. Ship-dark until sidecar is healthy.

| Env | Railway service | Public health |
|-----|-----------------|---------------|
| Staging | `secondop-presidio-image-redactor-staging` | `https://secondop-presidio-image-redactor-staging-staging.up.railway.app/health` |
| Production | `secondop-presidio-image-redactor` | `https://secondop-presidio-image-redactor-production.up.railway.app/health` |

Backend vars (staging + production):
- `IMAGE_DEID_ENABLED=true` — fail-closed when sidecar unreachable
- `PRESIDIO_IMAGE_REDACTOR_URL` — staging/prod public URLs above (or private DNS once verified)
- Reuses `PRESIDIO_MIN_SCORE`; optional `DICOM_PIXEL_REDACT_MODALITIES=US,SC,XC,OT`

Source: `secondop-backend-agentic/presidio-image-redactor/` (Docker build). Redeploy with `railway up ./presidio-image-redactor --path-as-root --service <name>`.

## 9) Post-Deploy Checks

1. API health endpoint returns 200:
- `GET /health`

2. API version routes respond:
- `GET /api/v1/...`

3. CORS check:
- Browser requests from frontend domain succeed (no CORS errors).

4. Logs:
- No repeated auth, DB connection, or OpenAI key errors.

5. Optional observability:
- If using Phoenix, verify traces/metrics ingestion.

## 9a) Linear / GitHub status updates after deploy

Required when deployment is in scope for the Linear issue(s):

1. **GitHub:** confirm the release commit is on `main` (merged PR). Do not leave deploy-only changes on a feature branch as the source of truth.
2. **Linear issue(s):**
   - Attach or comment: Railway deployment id(s), Vercel deployment id/URL, backend `gitSha` from `/version`, frontend `__SECONDOP_BUILD__.gitSha` when available.
   - Note staging smoke result **or** §0 exception checklist + post-deploy smoke evidence.
   - Move issue to `Done` only after merge **and** the agreed deploy/verification for that issue is complete.
3. **Backend ledger:** add an entry to `secondop-backend-agentic/docs/AGENT_RUN_LEDGER.md` for agent-assisted deploys (sanitized; no secrets).
4. If rollback occurred: document what was rolled back, to which prior deploy, and residual risk.

## 10) Quick Command Reference

```bash
# Backend
npm run dev
npm run build
npm start
npm run db:setup
npm run db:migrate
npm run db:seed

# Frontend
npm run dev
npm run lint
npm run build
npm run preview
```
