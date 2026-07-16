# SecondOp Backend API

Express + TypeScript API for the SecondOp medical second-opinion platform: auth, cases, file storage, AI case analysis, doctor opinions, and Command Center.

**Architecture (two orchestrators, storage, de-id, auth):** see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

**Workspace quickstart** (FE + BE together): parent [`README.md`](../README.md) in `SecondOP-Agentic`.

## Stack

- Express.js + TypeScript
- PostgreSQL
- JWT (access + refresh)
- File uploads (local / Railway Volume)
- LLM via gateway (`src/ai/`) — OpenAI direct or LiteLLM
- Optional Presidio de-identification, Phoenix tracing

## Local setup

```bash
cp .env.example .env
# Set DB_PASSWORD (compose default: postgres), JWT_SECRET, JWT_REFRESH_SECRET
# Optional: OPENAI_API_KEY for analysis

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

## Contributing

- **Branch from `origin/main`:**
  ```bash
  git fetch origin
  git checkout -B sec-NNN-short-title origin/main
  ```
- Workflow: [`AGENTS.md`](./AGENTS.md) and workspace root `AGENTS.md`
- Dated decisions: [`docs/decisions/`](./docs/decisions/)
- Do not merge/deploy without human approval

## Release metadata

- `GET /health` — health + compact version
- `GET /version` — release/build metadata

See `docs/RELEASE_VERSIONING.md`.
