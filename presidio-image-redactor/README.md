# Presidio image-redactor sidecar (SEC-129)

Thin FastAPI service that redacts burned-in PHI from report photos and US/SC/XC/OT DICOM pixels using Microsoft Presidio Image Redactor + Tesseract.

## Local

```bash
# From secondop-backend-agentic/
docker compose --profile deid up -d --build presidio-image-redactor
curl -s http://localhost:5003/health
```

Then set in `.env`:

```
IMAGE_DEID_ENABLED=true
PRESIDIO_IMAGE_REDACTOR_URL=http://localhost:5003
```

## Railway (SEC-130)

| Env | Service | Health |
|-----|---------|--------|
| Staging | `secondop-presidio-image-redactor-staging` | `https://secondop-presidio-image-redactor-staging-staging.up.railway.app/health` |
| Production | `secondop-presidio-image-redactor` | `https://secondop-presidio-image-redactor-production.up.railway.app/health` |

Redeploy from this directory:

```bash
railway up . --path-as-root --detach \
  --project <project> --environment staging \
  --service secondop-presidio-image-redactor-staging
```

Requires system libs for OpenCV (`libgl1`, `libglib2.0-0`) and `en_core_web_sm` (installed in Dockerfile).

## Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ "status": "ok" }` |
| POST | `/redact-image` | multipart `file` | redacted image bytes |
| POST | `/redact-dicom` | multipart `file` | redacted DICOM bytes |

Audit headers (never PHI values): `X-Entity-Count`, `X-Entity-Types`, `X-Skipped`.
