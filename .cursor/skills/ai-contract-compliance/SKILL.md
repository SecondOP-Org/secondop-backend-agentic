---
name: ai-contract-compliance
description: >-
  Ensures SecondOp LLM analysis outputs comply with AI_CONTRACT.md. Use when
  changing agentic code, case-analysis agents, analysis services, evals, prompts,
  orchestration, or any LLM-driven medical analysis behavior.
---

# AI Contract Compliance

Authoritative contract: workspace root `AI_CONTRACT.md`.

Engineering principles: `SOUL.md` — safety over fluency, determinism over autonomy, traceability by default, minimal privilege.

Scoped rule: workspace `.cursor/rules/10-ai-contract.mdc` (applies to agentic/analysis paths).

## Hard requirements (must not violate)

- Structured JSON only — no free-form-only output
- `confidence_score` in `[0.0, 1.0]`
- Required disclaimer: `AI-generated support content; licensed clinician review required.`
- `uncertainty_flags` when confidence is low or evidence is missing
- No diagnosis, treatment orders, or emergency directives
- No fabricated citations, measurements, or timeline events
- No claiming review of files/images/labs not received
- No direct DB access from LLM tools — persistence via audited services only

## Minimum output shape

```json
{
  "structured_summary": {},
  "questionnaire": { "specialist_questions": [] },
  "confidence_score": 0.0,
  "uncertainty_flags": [],
  "disclaimer": "AI-generated support content; licensed clinician review required."
}
```

## Key files

| Purpose | Path |
|---------|------|
| Contract checks | `src/evals/contractChecks.ts` |
| Analysis artifact service | `src/services/analysisArtifact.service.ts` |
| Analysis service | `src/services/analysis.service.ts` |
| Agentic runtime | `src/agentic/` |
| Case-analysis agents | `src/agents/case-analysis/` |

## Change workflow

1. Read `AI_CONTRACT.md` and inspect existing schema/validation in changed paths.
2. Implement with fixed prompts, bounded steps, schema-validated tool outputs.
3. Map findings to source sections when source text is available.
4. On schema validation failure: controlled retry/fallback, then fail closed.
5. Run checks:

```bash
npm run lint
npm test
npm run eval:harness
npm run build
```

6. Frontend: keep `secondop-fe-agentic/src/types/analysis.ts` aligned; render backend fields faithfully — do not invent medical claims in UI.

## Validation checklist

- [ ] Output includes all required fields
- [ ] Disclaimer text matches contract exactly
- [ ] Uncertainty surfaced when evidence is weak
- [ ] No LLM tool reads/writes DB directly
- [ ] `contractChecks` / eval harness pass
- [ ] Traceability preserved for persisted evidence snippets

## Frontend display contract

Render these backend artifact fields faithfully:
`structured_summary`, `questionnaire`, `confidence_score`, `uncertainty_flags`, `evidence_refs`, `disclaimer`.
