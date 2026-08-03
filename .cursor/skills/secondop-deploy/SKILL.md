---
name: secondop-deploy
description: >-
  Deploys SecondOp to staging and production (Railway backend, Vercel frontend).
  Use when deploying, releasing, promoting to production, running smoke tests after
  deploy, or following DEPLOYMENT_RUNBOOK.md.
---

# SecondOp Deploy

Authoritative runbook: workspace root `DEPLOYMENT_RUNBOOK.md` (versioned copy: `docs/DEPLOYMENT_RUNBOOK.md` in this repo).

Policy: `AGENTS.md` — **do not deploy without explicit human approval.**

Release paths (SEC-26):
- **Normal:** PR → CI → staging → smoke → human prod approval → production → post-deploy smoke → Linear/GitHub update
- **Exception (staging unavailable):** explicit human direct-to-prod approval + risk note + rollback readiness + post-deploy smoke evidence — see runbook §0

## Preconditions

- [ ] User explicitly approved deployment
- [ ] PR merged (or release branch agreed)
- [ ] Pre-deploy checks passed locally:

```bash
# Frontend
cd secondop-fe-agentic && npm ci && npm run lint && npm run build

# Backend
cd secondop-backend-agentic && npm ci && npm run lint && npm test && npm run build
```

## Staging order

1. Deploy backend to Railway staging (`secondop-backend-staging`)
2. Run migrations against staging DB:

```bash
export PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD" PGDATABASE="$DB_NAME"
npm run db:migrate
```

3. Verify backend health:

```bash
curl https://secondop-backend-staging-staging.up.railway.app/health
curl https://secondop-backend-staging-staging.up.railway.app/version
```

Expected: HTTP 200; health JSON `"status":"ok"`; version returns safe metadata (`productVersion`, `gitSha`, `environment`, etc.)

4. Deploy frontend to Vercel preview (staging API URL in env)
5. Staging smoke tests:
   - Login/register
   - Create case, send message, upload file
   - Billing route loads
   - CORS: frontend origin allowed on `/health`

## Production order

**Only after staging smoke tests pass and user approves production deploy.**

1. Confirm staging green
2. Deploy backend to Railway production
3. Run production DB migrations (same `db:migrate` flow with prod credentials)
4. Verify production `/health` and `/version`
5. Deploy frontend to Vercel production
6. Production smoke tests (same flow as staging)
7. Verify `window.__SECONDOP_BUILD__` in browser console for release metadata

## Post-deploy checks

- `GET /health` returns 200
- API routes respond under `/api/v1/`
- No CORS errors from frontend domain
- Logs: no repeated auth, DB, or OpenAI key errors

## Rollback (if release fails)

1. **Frontend:** re-deploy previous successful Vercel deployment
2. **Backend:** re-deploy previous Railway build; restore DB from backup if migration failed
3. **AI safety:** set `ANALYSIS_AGENTIC_MODE=off` or `shadow` if analysis causes regressions

## Platform reference

| Component | Staging | Production |
|-----------|---------|------------|
| Backend | Railway `secondop-backend-staging` | Railway production service |
| Frontend | Vercel Preview | Vercel Production |
| Database | Railway Postgres (staging) | Railway Postgres (production) |

Env var details: see `DEPLOYMENT_RUNBOOK.md` sections 3–4.

## Guardrails

- Never deploy without explicit user approval
- Never rotate secrets or change production config without approval
- Do not expose secret values in logs, comments, or ledger entries
- Update Linear when deploy completes if deployment was in issue scope
