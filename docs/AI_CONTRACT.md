# SecondOp AI Contract

## Scope
Applies to all LLM-driven analysis in `secondop-backend-agentic`.

## Hard Requirements
- Every AI response must be valid structured JSON (no free-form only output).
- Every AI response must include `confidence_score` in `[0.0, 1.0]`.
- AI must not present uncertain facts as confirmed medical facts.
- AI must not generate diagnosis, treatment orders, or emergency directives.
- AI must include a disclaimer in each recommendation-oriented output:
  - "AI-generated support content; licensed clinician review required."
- AI must flag uncertainty explicitly when confidence is low or evidence is missing.
- AI must not claim to have reviewed files, images, or labs it did not receive.
- AI must not fabricate citations, measurements, or timeline events.
- No direct DB access from LLM tools or prompts.
- Persistence must occur only via typed backend service methods.
- When `DEID_ENABLED=true`, raw PHI/PII from medical reports and intake narratives must never be
  sent to the LLM; only Presidio-tokenized text is analyzed. Durable `cases.analysis_*` fields
  store the de-identified twin by default. Token maps are sealed (AES-GCM) in
  `case_analysis_deid_vault` and retained until case completion/deletion so the case owner
  (patient) may re-identify via `?reveal_pii=true`. Specialists/org/operators have no reveal path.
  Reveal events are audited without storing re-identified text. `DEID_REVERSIBLE_KEY` is required
  when de-ID is on. De-identification failures fail closed (halt analysis; do not fall back to raw PHI).

## Required Output Shape (minimum)
```json
{
  "structured_summary": {},
  "patient_summary": {
    "overview": "",
    "what_your_results_show": "",
    "what_to_discuss": "",
    "next_steps": "",
    "what_we_couldnt_tell": "",
    "not_a_diagnosis": ""
  },
  "questionnaire": {
    "specialist_questions": []
  },
  "confidence_score": 0.0,
  "uncertainty_flags": [],
  "disclaimer": "AI-generated support content; licensed clinician review required."
}
```

`patient_summary` is the plain-language patient register (grade ~6–8). It mirrors clinical
`structured_summary` 1:1 (`overview`↔chief concern, `what_your_results_show`↔key findings,
`what_to_discuss`↔red flags, `next_steps`↔follow-up points, `what_we_couldnt_tell`↔limitations)
and may only restate findings already present (no new facts). Forbidden-claim rules apply to
both registers. Evidence substring grounding applies to clinical `evidence_refs` only — not to the
plain paraphrase. When `structured_summary` is populated, `patient_summary` (including
`not_a_diagnosis`) must also be populated; when clinical is empty, plain must be empty.
Questionnaire `specialist_questions` are patient-voice prompts for the reviewing specialist
(JSON key unchanged); each item may include `source` (`ai`|`patient`), `edited`, and `confirmed`.

When `DEID_ENABLED=true`, durable case analysis fields (`cases.analysis_*`) store the
**de-identified** twin by default. The sealed token map in `case_analysis_deid_vault` is retained
until case completion or deletion so the **case owner (patient)** may request re-identification
via `?reveal_pii=true`. Specialists, org, and operators never receive a reveal path. Reveal
events are audited without storing re-identified text. Vault maps are never logged or returned
to clients.
## Safety + Traceability
- Summaries should map key findings to source sections when possible.
- If extraction quality is poor, return partial output with explicit uncertainty flags.
- On schema validation failure, reject output and trigger controlled retry/fallback before failing closed.
- De-identification audit records (entity types, counts, scores — never raw PHI values or
  reversible mappings) may be stored with case analysis extraction artifacts for observability.

## Determinism Rules
- Prefer fixed prompts, bounded steps, and schema-validated tool outputs.
- Avoid open-ended autonomous behavior; use explicit orchestration policies.
