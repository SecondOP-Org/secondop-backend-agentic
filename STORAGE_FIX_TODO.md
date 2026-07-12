# P0 STORAGE FIX — Uploaded files "not found on server" (patient upload + doctor report View)

**Status: FIXED in production (SEC-68, merged 2026-07-11)** — see [PR #37](https://github.com/SecondOP-Org/secondop-backend-agentic/pull/37).

## Why this was the top priority
Uploaded PDFs were written to the Railway container's LOCAL disk (`./uploads`). That disk is
ephemeral — wiped on every redeploy/restart. By the time the file was read again, it was gone.
This broke TWO flows with the same root cause:

1. **Patient upload / AI analysis** — extraction failed with "file not found on server"
2. **Doctor case review** — **View** / **Download** on Medical Records returned "File not found on server"

The AI summary could still show because extracted text was cached in the DB; the raw file was gone.

## What was shipped

### STEP 1 — Railway Volume (infra) ✅
- Volume `secondop-backend-volume` mounted at `/data/uploads` on production `secondop-backend`

### STEP 2 — `UPLOAD_DIR=/data/uploads` (env) ✅
- Set on production backend service

### STEP 3 — Shared read/write path (code) ✅
- `src/utils/uploadPath.ts` — `resolveUploadDir()` + `resolveStoredFilePath()` (basename under `UPLOAD_DIR`)
- Used by `src/middleware/upload.ts`, `src/controllers/file.controller.ts`, `src/services/reportExtraction.service.ts`
- Tests: `src/__tests__/upload-path.test.ts`

### STEP 4 — Local dev unchanged ✅
- Local dev continues to use `./uploads` when `UPLOAD_DIR` is unset

## Production verification (2026-07-12)

Smoke script: `scripts/storage-smoke.mjs` + `scripts/storage-smoke-post.mjs`

| Check | Result |
|-------|--------|
| Patient upload PDF | ✅ |
| Patient download (pre-redeploy) | ✅ |
| AI analysis extraction (reads file from volume) | ✅ |
| Case submit + assign Dr. Smith | ✅ |
| Doctor API download (pre-redeploy) | ✅ |
| **Redeploy backend** | ✅ |
| Patient download (post-redeploy) | ✅ |
| Doctor API download (post-redeploy) | ✅ |

Smoke test case: `c9fce3de-c848-4077-94fc-7adf5ae6b314` (file `4046bd2a-e65b-4b16-b025-b1f3b1faf03b`)

Doctor UI **View** uses the same download/serve path as the API — API download success confirms the storage fix for doctor Medical Records.

## Migration note (still applies)
Files uploaded **before SEC-68** were on ephemeral disk and are **unrecoverable**. Demo cases
(e.g. Jane Doe) will keep showing "file not found" until the patient re-uploads. Only uploads
after the volume fix persist across redeploys.

## When to outgrow the Volume (not now)
Moving the worker to a separate service or scaling to 2+ replicas breaks a single Volume → switch
to Cloudflare R2 / S3. Until then, the Volume is the correct fix.

## Follow-up
- [x] Re-uploaded demo PDFs for `patient@example.com` cases on production (2026-07-12).
  Jane Doe case `SO-43f96bb4…` file id `645d83fb-b16e-4019-8f35-e3947c279aef`.
