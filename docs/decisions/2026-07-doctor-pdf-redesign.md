# 2026-07 — Doctor opinion PDF redesign

**Status:** Verified implemented (SEC-86 / SEC-115)  
**Related:** [SEC-86](https://linear.app/secondop/issue/SEC-86), [SEC-115](https://linear.app/secondop/issue/SEC-115)

## Context

`src/services/doctorOpinionPdf.service.ts` produces the branded attested PDF:

- Navy `#223B6C` + cream `#FAF9F6`
- Logo letterhead (`assets/secondop-logo.png`)
- Summary-first (`Clinical Impression`)
- Electronic signature block
- Draft watermark on preview

## Verification (SEC-115)

- Unit tests: `src/__tests__/doctorOpinionPdf.service.test.ts` (pass)
- Sanitized sample: `docs/evidence/sec-115-doctor-opinion-sample.pdf`
- Notes: `docs/evidence/README-SEC-115.md`

Staging/prod visual smoke remains part of the next batch deploy checklist.
