# SEC-115 verification evidence

Sanitized doctor-opinion PDF sample generated from current `main` generator (`doctorOpinionPdf.service.ts`) on 2026-07-17.

## Checklist (code + unit tests + local sample)

| Criterion | Result |
|-----------|--------|
| Brand navy `#223B6C` | Pass (`BRAND_COLOR` / `RULE_COLOR`) |
| Cream page `#FAF9F6` | Pass (`CREAM_COLOR`) |
| Logo letterhead | Pass (`assets/secondop-logo.png` + `drawLetterhead`) |
| Summary-first (`Clinical Impression`) | Pass (unit test + layout order) |
| E-signature block | Pass (`Electronically signed by` / Electronic signature) |
| Draft watermark on preview | Pass (unit test) |
| Staging/prod visual spot-check | Deferred to next batch deploy smoke |

Sample file: `sec-115-doctor-opinion-sample.pdf` (synthetic names only; no PHI).
