# 2026-07 — Optional AI analysis on case submit (Option A)

**Status:** Done in code  
**Related:** [SEC-100](https://linear.app/secondop/issue/SEC-100)

## Decision

AI analysis is a helper, never a gate for case submission. Patients may upload PDFs, skip Analyze, and still submit. Only an **in-flight** analysis should block submit.

## Outcome

Flexible specialist questions parsing and submit rules updated in `case.controller.ts` / related parsers so empty questions + `analysis_status = not_started` succeed when AI was skipped.

Supersedes root `OPTION_A_OPTIONAL_AI_BACKEND.md` (removed).
