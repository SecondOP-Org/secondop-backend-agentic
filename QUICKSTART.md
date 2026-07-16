# Quick start

This file is a short pointer. Use:

1. **Workspace** [`../README.md`](../README.md) — dual-repo setup (FE + BE) in under 30 minutes  
2. **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — case-analysis flow and two-orchestrator story  
3. **This repo’s [`README.md`](./README.md)** — backend-only commands

```bash
cp .env.example .env
docker compose up -d postgres
npm ci && npm run db:setup && npm run db:seed && npm run dev
```

API: `http://localhost:8081` · seeds: `patient@example.com` / `dr.smith@secondop.com` · password `password123`.
