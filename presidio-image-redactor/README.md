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

## Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ "status": "ok" }` |
| POST | `/redact-image` | multipart `file` | redacted image bytes |
| POST | `/redact-dicom` | multipart `file` | redacted DICOM bytes |

Audit headers (never PHI values): `X-Entity-Count`, `X-Entity-Types`, `X-Skipped`.
