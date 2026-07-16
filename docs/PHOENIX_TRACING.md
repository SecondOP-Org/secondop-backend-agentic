# Phoenix tracing (SEC-103)

Phoenix is an **optional** OpenTelemetry UI for analysis spans. The **Postgres run ledger** (`case_analysis_runs` / `events` / `artifacts` and `GET /api/v1/cases/:caseId/analysis/trace`) remains the product source of truth.

## Production

| Item | Value |
|------|--------|
| Phoenix UI | https://secondop-phoenix-production.up.railway.app |
| Railway service | `secondop-phoenix` (image `arizephoenix/phoenix`) |
| Durable DB | Railway Postgres service `Postgres-I7v9` via `PHOENIX_SQL_DATABASE_URL` |
| Backend project name | `secondop-agent-analysis` (`PHOENIX_PROJECT_NAME`) |

Backend production env (Railway `secondop-backend`):

- `PHOENIX_ENABLED=true`
- `PHOENIX_COLLECTOR_URL=https://secondop-phoenix-production.up.railway.app`
- `PHOENIX_PROJECT_NAME=secondop-agent-analysis`
- `PHOENIX_API_KEY` — system API key (Bearer) created in Phoenix UI / GraphQL

Auth is **enabled** on the Phoenix service (`PHOENIX_ENABLE_AUTH=True`). Treat the UI as a sensitive ops surface (case/run metadata may appear in span attributes).

### Operator login

1. Open https://secondop-phoenix-production.up.railway.app/login  
2. Email: `admin@localhost`  
3. Password: Railway variable `PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD` on service `secondop-phoenix`  
4. **Change the admin password** immediately after first login  
5. Create/rotate system API keys under Settings → API Keys if needed; update Railway `PHOENIX_API_KEY` on `secondop-backend` and redeploy

### Viewing a run

1. Trigger case analysis in production  
2. In Phoenix UI → project **secondop-agent-analysis** → traces/spans  
3. Also use platform UI: `https://secondop.in/analysis-observability?caseId=...` (DB ledger)

## Local

```bash
docker run -d --name secondop-phoenix -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
```

`.env`:

```env
PHOENIX_ENABLED=true
PHOENIX_PROJECT_NAME=secondop-agent-analysis
PHOENIX_COLLECTOR_URL=http://localhost:6006
# PHOENIX_API_KEY=   # only if local Phoenix has auth on
```

Restart the API after changing env.

## Staging

Not configured yet (no `secondop-backend` service linked in Railway `staging` at setup time). Mirror production when staging backend exists.

## Safety

- Do not commit API keys or admin passwords  
- Prefer DB `/analysis/trace` for durable audit; Phoenix for interactive span inspection  
- Rotate `PHOENIX_SECRET` / admin password / API keys if they appear in logs or chat
