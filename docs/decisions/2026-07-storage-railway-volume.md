# 2026-07 — Storage: Railway Volume for uploads

**Status:** Done (SEC-68)  
**Linear:** [SEC-68](https://linear.app/secondop/issue/SEC-68) (historical) · related onboarding [SEC-100](https://linear.app/secondop/issue/SEC-100)

## Decision

Upload files on Railway must use a persistent Volume mounted at `/data/uploads` with `UPLOAD_DIR=/data/uploads`. All read/write paths go through `src/utils/uploadPath.ts`.

## Why

Container local disk (`./uploads`) is ephemeral. Redeploys deleted patient PDFs, breaking extraction and doctor View/Download even when analysis text remained in Postgres.

## Outcome

- Volume `secondop-backend-volume` on production backend
- Shared path helpers + tests (`upload-path.test.ts`)
- Local default remains `./uploads`

Supersedes root `STORAGE_FIX_TODO.md` (removed).
