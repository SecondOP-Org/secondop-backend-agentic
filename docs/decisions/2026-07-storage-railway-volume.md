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

## Prevention & recovery (SEC-181)

Postgres stores case/file/study metadata; DICOM **bytes** live only on the volume. If the volume is missing, remounted empty, or files are deleted outside the app, specialists can still open PDF records while Imaging and DICOM-dependent analysis look empty.

**Prevention**
1. Keep production volume mounted at `/data/uploads` with `UPLOAD_DIR=/data/uploads` (not ephemeral disk).
2. Single backend replica while the analysis worker is in-process and storage is local-volume.
3. Do not recreate the volume without a backup restore plan.
4. After production deploys, spot-check a known case with imaging (View + study download).

**Recovery**
1. Confirm the volume is still attached and `UPLOAD_DIR` points at it.
2. Restore from backup if available; otherwise re-upload the study.
3. Frontend shows an explicit “imaging unavailable” empty state when DICOM file metadata or study rows exist but no viewable instances — not “never uploaded.”
4. Re-run analysis only after bytes are restored.

See also workspace root `DEPLOYMENT_RUNBOOK.md` (Imaging / upload durability).
