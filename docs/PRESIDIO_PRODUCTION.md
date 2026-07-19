# Presidio production networking (SEC-104)

When `DEID_ENABLED=true`, the backend **must** reach Presidio over real URLs. Leaving `PRESIDIO_*_URL` unset defaults to `localhost:5002/5001`, which fails closed on Railway with `fetch failed` and blocks case analysis.

## Required backend env (staging + production)

| Variable | Purpose |
|----------|---------|
| `DEID_ENABLED=true` | Enable text PHI tokenization before LLM prompts |
| `DEID_REVERSIBLE_KEY` | Seal vault mappings (required when enabled) |
| `PRESIDIO_ANALYZER_URL` | Analyzer base URL (no trailing slash) |
| `PRESIDIO_ANONYMIZER_URL` | Anonymizer base URL (optional for current tokenize path; still probed for readiness) |
| `PRESIDIO_MIN_SCORE` | Default `0.5` |
| `PRESIDIO_TIMEOUT_MS` | Default `10000`–`15000` on Railway |

### Current Railway services

| Env | Analyzer | Anonymizer |
|-----|----------|------------|
| Production | `secondop-presidio-analyzer` → public `*.up.railway.app` | `secondop-presidio-anonymizer` |
| Staging | `secondop-presidio-analyzer-staging` → prefer `*.railway.internal` | `secondop-presidio-anonymizer-staging` |

Staging backends may use private DNS (`http://<service>.railway.internal:<port>`). Production currently uses public HTTPS URLs. Prefer private DNS once verified in each environment.

## Pixel PHI (separate flag)

See SEC-129 / SEC-130 and `presidio-image-redactor/README.md`:

- `IMAGE_DEID_ENABLED`
- `PRESIDIO_IMAGE_REDACTOR_URL`

## Verification

```bash
curl -sS "$PRESIDIO_ANALYZER_URL/health"
curl -sS "$PRESIDIO_ANONYMIZER_URL/health"
# Authenticated operator:
curl -sS -H "Authorization: Bearer $TOKEN" \
  https://<backend>/api/v1/presidio/status
```

Service Health dashboard also probes Presidio (`presidio_health`).

## Symptom → fix

| Symptom | Likely cause |
|---------|----------------|
| `De-identification unavailable… fetch failed` | `PRESIDIO_*_URL` missing/wrong or sidecar down |
| Analysis never starts with de-id enabled | Same; fail-closed by design |
| `ready: false` on `/presidio/status` | Sidecar unhealthy or `DEID_REVERSIBLE_KEY` missing |
