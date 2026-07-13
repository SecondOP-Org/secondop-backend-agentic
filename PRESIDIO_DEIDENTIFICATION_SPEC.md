# Spec — PII/PHI De-identification with Microsoft Presidio

## Why
SecondOp sends extracted medical-report text and patient intake to LLMs (via the LiteLLM gateway)
for the LangGraph analysis pipeline. Today that text can contain raw PHI/PII — patient name, DOB,
MRN, phone, address, email. Running it through Microsoft **Presidio** lets us **detect and
de-identify PHI before it leaves our trust boundary for the model**, then optionally re-identify it
for the clinician-facing artifact. This:

- Minimizes PHI exposure to third-party LLM providers (HIPAA "minimum necessary"; DPDP Act; the
  SOC2/ISO/GDPR posture the platform claims).
- Adds an auditable de-identification step (what was detected, what was redacted, confidence).
- Matches the privacy story we tell patients (see `PrivacyPolicyPage.tsx`) and is a real,
  demonstrable control — not a checkbox.

## What Presidio is (and the basic things we can do)
Presidio is an open-source Microsoft toolkit with two services:
- **presidio-analyzer** — detects PII/PHI entities in text (NER + regex + context). Returns entity
  type, span, and confidence score.
- **presidio-anonymizer** — transforms detected spans: **redact**, **replace** (`<PERSON>`),
  **mask** (`****1234`), **hash**, or **encrypt** (reversible).

Basic capabilities we'll use:
- Detect: `PERSON`, `DATE_TIME`, `PHONE_NUMBER`, `EMAIL_ADDRESS`, `LOCATION`, `US_SSN`,
  `CREDIT_CARD`, `IP_ADDRESS`, plus **custom recognizers** for medical identifiers (MRN, insurance
  member ID, accession number) via regex + context words.
- Anonymize with a **reversible** strategy (encrypt or a token→value vault) so the pipeline works
  on de-identified text but the **clinician still sees real names** in the final report.
- Confidence thresholds + allow/deny lists to tune precision (don't redact clinical terms).
- An audit record of every entity detected and action taken per case.

## Architecture — Presidio as a sidecar microservice
Presidio is Python; our backend is Node/TypeScript. Run Presidio as **containerized HTTP services**
the Node backend calls. This keeps language boundaries clean and is Railway/Docker-friendly.

```
extraction/OCR (Node)                 Presidio (Python containers)
  reportExtraction.service.ts  ──►  POST /analyze   (presidio-analyzer)
  visionOcr.service.ts               POST /anonymize (presidio-anonymizer)
        │                                   │
        ▼                                   ▼
  deidentification.service.ts  ◄── de-identified text + entity map
        │
        ▼
  LangGraph analysis (LLM via LiteLLM)  ← receives DE-IDENTIFIED text only
        │
        ▼
  re-identify for clinician artifact (optional, Phase 2)
```

### docker-compose (add two services)
```yaml
  presidio-analyzer:
    image: mcr.microsoft.com/presidio-analyzer:latest
    ports: ["5002:3000"]
    profiles: ["deid"]
  presidio-anonymizer:
    image: mcr.microsoft.com/presidio-anonymizer:latest
    ports: ["5001:3000"]
    profiles: ["deid"]
```
On Railway, deploy these as two small services (or one combined image); Node reaches them via
internal URLs.

## Code changes (Node backend)

### 1. New client + service
- `src/services/presidio.client.ts` — thin HTTP client:
  - `analyze(text, language='en'): Promise<AnalyzerResult[]>` → POST `${PRESIDIO_ANALYZER_URL}/analyze`
  - `anonymize(text, analyzerResults, operators): Promise<{ text, items }>` → POST `${PRESIDIO_ANONYMIZER_URL}/anonymize`
- `src/services/deidentification.service.ts` — orchestrates:
  - `deidentify(text): Promise<{ deidentifiedText, mapping, entities }>`
  - Uses a **reversible** operator (encrypt with a server-side key, or a per-case token vault) so
    `reidentify(text, mapping)` can restore values for the clinician view.
  - Applies confidence threshold (`PRESIDIO_MIN_SCORE`, default 0.5) + a deny-list of clinical
    terms to avoid over-redaction.

### 2. Plug into the pipeline (before the LLM)
- In `src/services/reportExtraction.service.ts` and `src/services/visionOcr.service.ts`, after text
  is extracted, pass it through `deidentification.service.deidentify()` **before** it's handed to
  the analysis agents.
- In the case-analysis agents (`src/agents/case-analysis/*`, `runCaseAnalysis.ts`), ensure the text
  sent to the LLM via LiteLLM is the **de-identified** text. Store the mapping alongside the case
  (not sent to the model).
- Intake fields (name/DOB/contact) should NOT be sent to the LLM at all — pass only the clinically
  relevant, de-identified narrative.

### 3. Custom medical recognizers
- Add regex+context recognizers for `MRN`, `INSURANCE_ID`, `ACCESSION_NUMBER` (Presidio supports
  custom recognizers via the analyzer config / ad-hoc recognizers in the `/analyze` request).

### 4. Audit + contract
- Persist a per-case de-identification record: entities detected (type, count, score), operator
  used, timestamp. Surface in the admin `AnalysisObservability` / Mission Control view.
- Update `AI_CONTRACT.md`: "raw PHI is never sent to the LLM; only de-identified text is analyzed."

## Config / env
```
PRESIDIO_ANALYZER_URL=http://presidio-analyzer:3000
PRESIDIO_ANONYMIZER_URL=http://presidio-anonymizer:3000
PRESIDIO_MIN_SCORE=0.5
DEID_ENABLED=true            # feature flag; false = today's behavior
DEID_REVERSIBLE_KEY=...      # server-side key for reversible anonymization (secret)
```
Feature-flag it (`DEID_ENABLED`) so it can ship dark and be validated before enforcing.

## Phasing
- **Phase 1 (privacy win, ship first):** detect + **redact/replace** PHI before the LLM. Clinician
  artifact may show placeholders for names; acceptable for a first cut. Add audit record.
- **Phase 2 (clinician UX):** reversible tokenization + `reidentify()` so the final artifact shows
  real names/dates while the LLM only ever saw tokens.
- **Phase 3:** custom medical recognizers (MRN/insurance/accession), tuning (deny-list, thresholds),
  and eval cases proving no PHI leaks to the model.

## Guardrails
- De-identification failure must **fail closed** — if Presidio is unreachable and `DEID_ENABLED`,
  do NOT fall back to sending raw PHI to the LLM; surface an error and halt analysis.
- Never log raw PHI or the reversible mapping in plaintext logs.
- Keep the mapping/key server-side only; never return it to the client.

## Acceptance
- [x] With `DEID_ENABLED=true`, text sent to the LLM (captured in the LiteLLM/analysis trace)
      contains no raw patient name, DOB, MRN, phone, email, or address.
- [x] Presidio analyzer detects seeded PHI in a test report with score ≥ threshold; anonymizer
      redacts/replaces them. *(Phase 2+: unique token vault built from analyzer spans; custom medical ad-hoc recognizers on analyze.)*
- [x] Phase 2: the clinician-facing artifact shows correct real values via `reidentify()`, while the
      model trace still shows tokens.
- [x] Custom MRN/insurance recognizers detect sample identifiers. *(ad-hoc recognizers + unit coverage; live container detection requires Presidio up.)*
- [x] If Presidio is down, analysis fails closed (no raw PHI sent); clear error surfaced.
- [x] De-identification audit record is stored per case and visible in admin observability.
      *(entity types/counts on extraction artifact; no raw PHI values or mappings)*

## Tests
- `src/__tests__/deidentification.service.test.ts` — analyze→tokenize→reidentify round-trip; PHI
  absent from de-identified / prompt text; custom medical entities; sealed mapping; fail-closed
  when Presidio unavailable (mock).

## Known residual gaps
- Vision OCR still sends document **images** to an LLM before text de-id (pixel PHI). Text path is covered.
- Railway deployment of Presidio sidecars is ops work (not coded here).

## Production durability (vault)
- Sealed AES-GCM token maps persist in `case_analysis_deid_vault` keyed by `run_id` **before** the LLM call.
- Reidentify falls back to vault if in-memory map is empty (crash/retry safety).
- Vault ciphertext is cleared after successful clinician persist (minimize retention).
- Failed runs keep the sealed map for recovery until success/clear.
- `DEID_ENABLED=true` requires `DEID_REVERSIBLE_KEY`.
- Doctor status: `GET /api/v1/presidio/status` (no secrets/PHI).

## Note
Per repo workflow, open a Linear issue before implementing. This also makes the resume's
"Microsoft Presidio" claim actually true rather than aspirational.
