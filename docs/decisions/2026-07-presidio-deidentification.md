# 2026-07 — Presidio text + DICOM de-identification

**Status:** Implemented; often ship-dark via `DEID_ENABLED`  
**Related:** [SEC-100](https://linear.app/secondop/issue/SEC-100) · see also DICOM de-id work (SEC-84)

## Decision

- Text PHI: Microsoft Presidio analyzer/anonymizer (compose profile `deid`), vaulted mappings in Postgres.
- DICOM: tag scrubbing in `dicomDeidentification.service.ts` with fail-closed behavior when enabled.
- Analysis must not send identified content to the LLM when de-id is enabled and fails.
- Pixel PHI (SEC-129): optional Presidio image-redactor sidecar; `IMAGE_DEID_ENABLED` (default false).
  Redact before storage and before vision-OCR; fail closed when enabled and unreachable.
  Modalities: US/SC/XC/OT (+ RGB/photographic); plain CT/MR skip pixel OCR.

## Key code

- `src/services/deidentification.service.ts`, `presidio.client.ts`, `deidVault.service.ts`
- `src/services/dicomDeidentification.service.ts`
- `src/services/imageRedaction.service.ts`, `presidio-image-redactor/`
- Migrations `020_case_analysis_deid_vault.sql`, `022_dicom_deid_vault.sql`

## Note

Default local/prod may keep `DEID_ENABLED=false` / `IMAGE_DEID_ENABLED=false` until sidecars and ops readiness. Check env before assuming de-id is active.

Supersedes root `PRESIDIO_DEIDENTIFICATION_SPEC.md` (removed).
