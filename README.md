# SecondOp Backend API

Express + TypeScript API for the SecondOp medical second-opinion platform: auth, cases, file storage, AI case analysis, doctor opinions, and Command Center.

**Production analysis is agentic-primary.** `GET /version` reports `analysisExecutionMode: agentic`. Baseline still exists for local/eval and gold-set comparison; shadow-mode is retired as a production cutover gate.

**Architecture** (orchestrators, storage, de-id, auth): [`ARCHITECTURE.md`](./ARCHITECTURE.md).

**Workspace quickstart** (FE + BE together): parent [`README.md`](../README.md) in `SecondOP-Agentic`.

## Stack

- Express.js + TypeScript
- PostgreSQL
- JWT (access + refresh)
- File uploads (local / Railway Volume)
- LLM via gateway (`src/ai/`) — OpenAI direct or LiteLLM
- Optional Presidio de-identification, Phoenix tracing
- Gold-set evals persisted to `gold_eval_runs` (migration `032`)

## Local setup

```bash
cp .env.example .env
# Set DB_PASSWORD (compose default: postgres), JWT_SECRET, JWT_REFRESH_SECRET
# Optional: OPENAI_API_KEY for analysis
# ANALYSIS_EXECUTION_MODE=agentic matches production (see .env.example)

docker compose up -d postgres
npm ci
npm run db:setup
npm run db:seed
npm run dev
```

- API: `http://localhost:8081` · `GET /health` (see `.env.example` `PORT`; avoid 5000 on macOS AirPlay)
- Env template: `.env.example`

### Seeded logins

| Role | Email | Password |
|------|-------|----------|
| Patient | `patient@example.com` | `password123` |
| Doctor | `dr.smith@secondop.com` | `password123` |

### Optional compose profiles

```bash
docker compose --profile tools up -d pgadmin          # :5050
docker compose --profile ai-gateway up -d             # LiteLLM
docker compose --profile deid up -d                   # Presidio
```

## Analysis mode

| Env | Meaning |
|-----|---------|
| `ANALYSIS_EXECUTION_MODE=agentic` | User-facing result is the agentic runtime (production) |
| `ANALYSIS_EXECUTION_MODE=baseline` | Sequential five-step pipeline only |
| `ANALYSIS_EXECUTION_MODE=shadow` | Legacy; not used as a production gate |

Confirm the live value with `GET /version` (`analysisExecutionMode`, `gitSha`, `deploymentId`). Details: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Gold-set evals

Clinician-authored gold cases are scored against baseline and agentic engines. Operators view the trend at **`GET /api/v1/admin/gold-evals`** (frontend: `/admin/gold-evals`).

Checklist gates (after agentic cutover): `gold_correctness`, `gold_safety`, `gold_trend`. Operational links (GitHub / Railway / Phoenix / backend) are emitted only when their env sources exist (`PHOENIX_PUBLIC_URL`, etc.).

```bash
npm run eval:gold:fast          # smoke subset
npm run eval:gold               # full set, both engines
```

Nightly job: [`.github/workflows/gold-evals.yml`](.github/workflows/gold-evals.yml) (06:00 UTC + `workflow_dispatch`). Persist needs GitHub Actions secrets `OPENAI_API_KEY_EVAL` and `GOLD_EVAL_DATABASE_URL` (public Postgres URL, not `*.railway.internal`). Spec: [`docs/SEC-205-GOLD-SET-EVAL-HARNESS-SPEC.md`](./docs/SEC-205-GOLD-SET-EVAL-HARNESS-SPEC.md).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Nodemon API |
| `npm run db:setup` | Create DB + migrations |
| `npm run db:seed` | Seed demo data |
| `npm test` | Jest |
| `npm run lint` | ESLint |
| `npm run build` | `tsc` |
| `npm run eval:harness` | Contract/critic evals |
| `npm run eval:gold` | Full gold-set eval (both engines) |
| `npm run eval:gold:fast` | Gold-set smoke subset |
| `npm run e2e:smoke` | API smoke script |

## Operator APIs

Allowlisted admin routes (see `.env.example`): Command Center, service health, gold evals, analysis attention.

- `GET /health` — health + compact version
- `GET /version` — release/build metadata including `analysisExecutionMode`
- `GET /api/v1/admin/gold-evals` — gold-eval trend, checklist, operational links

See `docs/RELEASE_VERSIONING.md`.

## Deploy

Production API is **Railway** (`secondop-backend`). Prefer a **GitHub-source deploy of `main`** from the Railway dashboard (or `serviceInstanceDeployV2` with the commit SHA). CLI `railway up` and “redeploy last image” can miss new commits or fail TLS.

Do not merge, deploy, or change production env without human approval. Sequence: [`docs/DEPLOYMENT_RUNBOOK.md`](./docs/DEPLOYMENT_RUNBOOK.md).

## Contributing

- **Branch from `origin/main`:**
  ```bash
  git fetch origin
  git checkout -B sec-NNN-short-title origin/main
  ```
- Workflow: [`AGENTS.md`](./AGENTS.md) and workspace root `AGENTS.md`
- LLM outputs: [`docs/AI_CONTRACT.md`](./docs/AI_CONTRACT.md)
- Dated decisions: [`docs/decisions/`](./docs/decisions/)
- Agent run ledger: [`docs/AGENT_RUN_LEDGER.md`](./docs/AGENT_RUN_LEDGER.md)
