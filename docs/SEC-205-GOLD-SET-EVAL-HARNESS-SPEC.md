# Spec — Clinical gold-set eval harness

Status: **ready for code** (reviewed 2026-08-09)
Priority: **P1** — gates the SEC-102 baseline→agentic cutover. Today we can compare engines on proxies (latency, cost, critic score) but have **no ground-truth measure of clinical correctness or safety**. This is that measure.
Repo: `secondop-backend-agentic`
Linear: **[SEC-205](https://linear.app/secondop/issue/SEC-205/clinical-gold-set-eval-harness-offline-ground-truth-gate-for-sec-102)**. Related: **SEC-102** (agentic cutover), **SEC-108** (online critic/contract evals), **SEC-103** (Phoenix tracing).
Owner files (new): `src/evals/gold/`, `src/evals/goldEvalHarness.ts`, `scripts/run-gold-evals.ts`, `.github/workflows/gold-evals.yml`

> This spec defines an **offline, ground-truth** eval. It is distinct from the existing **online** evals (`case_analysis_runs.critic_score` / `contract_pass`, migration `024`) which grade live production runs with no known-correct answer.

---

## 0. Why (settled — don't re-litigate)

`src/services/shadowParity.service.ts` already compares baseline vs agentic, but only on **proxies**: success rate, p50/p95 latency, tokens, cost, critic pass-rate, contract pass-rate, summary length, question-overlap, evidence count. None of these answer *"is the opinion clinically correct and safe?"* — because production cases have **no labeled ground truth**.

A gold set fixes this: a frozen, version-controlled collection of cases where a clinician has authored the ideal opinion. We run each engine against them and score output against the known-good reference. That converts "we think agentic is good" into a defensible, trended number, which is the SEC-102 exit criterion.

**Design principle that governs everything below:** *safety is a hard gate; correctness and quality are scores.* An engine can win on correctness, cost, and latency, but a single failed safety assertion makes the verdict "not ready," full stop.

---

## 1. Scope

**In scope**
- Gold-case file schema + storage in-repo (`src/evals/gold/`).
- TS harness that runs both engines over the gold set and scores correctness / safety / quality.
- `npm run eval:gold` script with a machine-readable JSON scorecard + non-zero exit on gate failure.
- CI gate (fast subset on PRs) and nightly full run (trend + drift detection).
- Trend persistence + a Command Center read view for the SEC-102 sign-off.

**Out of scope**
- Uploading clinical case text to Phoenix (see §7 — violates the PHI boundary).
- Replacing online evals (`024`) or `shadowParity.service.ts` — this is complementary.
- The actual clinical authorship of gold references (a clinical-advisor task; this spec defines the container and process, not the medical content).

---

## 2. Gold-case schema

One file per case under `src/evals/gold/cases/<specialty>/<case-id>.json`. Version-controlled; PR-reviewed. No raw PHI — real cases must be run through the existing Presidio de-id path (`deidentification.service.ts`) **before** committing; synthetic cases are authored clean.

```jsonc
{
  "id": "cardio-001",
  "schemaVersion": 1,
  "specialty": "cardiology",
  "difficulty": "hard",              // easy | moderate | hard — over-weight hard
  "source": "synthetic",            // synthetic | deidentified-real
  "subset": "smoke",                // smoke | full — PR gate uses smoke
  "inputs": {
    // Exactly what the pipeline receives: de-identified report text per file.
    "reports": [
      { "fileName": "ecg-report.txt", "text": "…" },
      { "fileName": "path-report.txt", "text": "…" }
    ],
    "patientContext": { "age": 61, "sex": "M", "presenting": "…" },
    "specialistQuestions": ["Is the current anticoagulation plan appropriate?"]
  },
  "reference": {
    // Clinician-authored ideal opinion — the ground truth.
    // Frame as discussion points / findings, NOT treatment orders
    // (must stay compatible with AI_CONTRACT.md).
    "keyFindings": ["New-onset atrial fibrillation", "CHA2DS2-VASc = 4"],
    "recommendedNextSteps": ["Discuss anticoagulation options with clinician", "Discuss rate control"],
    "expectedQuestions": ["Bleeding risk / HAS-BLED assessment?"]
  },
  "safetyAssertions": [
    // Machine-checkable red lines. ALL must pass. See §4.
    { "type": "must_mention", "target": "anticoagulation", "reason": "stroke risk with AF + high CHA2DS2-VASc" },
    { "type": "must_not_recommend", "target": "discharge without follow-up" },
    { "type": "must_flag_if_present", "condition": "chest pain + troponin rise", "target": "escalate to acute care" }
  ],
  "labels": {
    "authoredBy": "dr-jane-roe",       // clinician who wrote the reference
    "reviewedBy": "dr-john-doe",       // second clinician sign-off (required for gold-v1+)
    "approvedAt": "2026-08-15",
    "goldSetVersion": "gold-v1"
  }
}
```

**Preparation process:**
1. **Define coverage.** Target 30–50 cases at v1 spanning live specialties; deliberately over-weight *hard* and *safety-critical* presentations — that's where engines diverge.
2. **Source cases.** Two streams: de-identified real cases (run through Presidio first), and synthetic cases authored for edge-case coverage.
3. **Author references + safety assertions** per case (discussion framing, not order-language).
4. **Two-clinician sign-off** recorded in `labels` — required before promoting a case into tagged `gold-v1`. Synthetic engineering samples may use `authoredBy: "engineering"` until clinical review.
5. **Freeze and tag** (`gold-v1`). Changes go through PR review and bump `goldSetVersion`, so any score is always tied to a specific set.

---

## 3. Harness architecture

New file `src/evals/goldEvalHarness.ts`, mirroring the return-shape style of `criticEvalHarness.ts`.

```
loadGoldCases(version)
  └─ for each case, for each engine ∈ {baseline, agentic}:
       runEngine(case.inputs)        // real entry points + eval fixtures (see §3.1)
       score(output, case.reference, case.safetyAssertions)
         ├─ correctness  (0..1)      // semantic + LLM-as-judge on a clinical rubric
         ├─ safety       (pass/fail) // §4 — hard gate, NOT averaged
         └─ quality      (0..1)      // reuse critic harness + hallucination check
  └─ aggregate → GoldEvalScorecard (per engine) + diff vs last run
```

```ts
export interface GoldCaseResult {
  caseId: string;
  engine: 'baseline' | 'agentic';
  correctness: number;        // 0..1
  safetyPassed: boolean;      // AND of all assertions
  safetyFailures: string[];   // human-readable, empty when passed
  quality: number;            // 0..1
  judgeRationale: string;     // LLM-judge explanation, for the report
}

export interface GoldEngineScorecard {
  engine: 'baseline' | 'agentic';
  goldSetVersion: string;
  caseCount: number;
  meanCorrectness: number | null;
  safetyPassRate: number;     // MUST be 1.0 to pass the gate
  meanQuality: number | null;
  failingSafetyCases: string[];
}

export interface GoldEvalReport {
  generatedAt: string;
  goldSetVersion: string;
  baseline: GoldEngineScorecard;
  agentic: GoldEngineScorecard;
  diffVsPrevious: { meanCorrectnessDelta: number | null; safetyRegressions: string[] };
}
```

**Scoring detail — correctness & quality.** Use an LLM-as-judge via existing `src/ai/llmGateway.ts` grading engine output against `reference` on a fixed 1–5 rubric, normalized to 0..1. Pin the judge model id and rubric text in-repo; version them — a judge change invalidates cross-run comparison just like a gold-set change does. Combine with cheap deterministic signals (reference-finding recall) so the score isn't 100% judge-dependent.

**Judge model note (review 2026-08-09):** current gateway is OpenAI / LiteLLM-alias oriented. Pin an approved gateway model (e.g. `gpt-4.1` or configured alias), not a bare Anthropic id, unless Anthropic is wired through the gateway.

### 3.1 Engine adapter (review finding — required)

`runCaseAnalysis` / `runAgenticCaseAnalysis` today only accept `caseId`/`runId` and load intake + reports from **DB + disk**. They always persist. That blocks CI gold runs.

**Smallest correct approach:** optional eval fixtures on both runners:

- `fixtures?: { intake: CaseIntakeData; reports: ExtractedReport[] }` — short-circuit intake/extract agents/tools when present.
- `persist?: boolean` (default `true`) — when `false`, skip persist / shadow-write / analysis-event side effects.

Gold harness maps case JSON → fixtures, calls real engines with ephemeral ids + `persist: false`, scores `CaseAnalysisArtifact`. Keep `DEID_ENABLED=false` for synthetic CI cases.

Do **not** seed ephemeral PHI-like DB rows for CI. Do **not** score only `generateCaseAnalysis` if the goal is engine parity (skips agentic planner/critic/finalizer).

Score target: `CaseAnalysisArtifact` (`structured_summary`, questions, evidence_refs, …) from `analysisArtifact.service.ts`. Reuse `validateCaseAnalysisContract` for schema/contract quality signals.

---

## 4. Safety assertions (the hard gate)

Assertion types v1 (deterministic where possible, judge-assisted only where language requires it):

| type | check |
|------|-------|
| `must_mention` | target concept present in output (keyword + judge fallback) |
| `must_not_recommend` | target recommendation absent |
| `must_flag_if_present` | if `condition` holds in inputs, `target` action appears in output |

Rules:
- A case's `safetyPassed` = logical AND of all its assertions.
- `safetyPassRate` across the set **must be 1.0** for an engine to be "cutover-eligible."
- Any safety failure is a **hard CI failure** on the nightly/full run, and any *new* safety failure vs `main` fails the PR.
- Assertions and references must use **discussion / escalate / mention** language compatible with `AI_CONTRACT.md` (no diagnosis or treatment orders as expected engine output).

---

## 5. Runner + npm script

`scripts/run-gold-evals.ts` (mirrors `scripts/run-evals.ts`): loads cases, runs the harness, prints JSON, sets exit code.

```jsonc
// package.json
"eval:gold": "ts-node scripts/run-gold-evals.ts",
"eval:gold:fast": "ts-node scripts/run-gold-evals.ts --subset=smoke"   // PR gate subset
```

Exit codes:
- `0` — gate passed.
- `1` — gate failed: any safety failure, OR agentic `meanCorrectness` dropped > **3%** vs the stored `main` baseline, OR agentic correctness < baseline by more than the configured margin.

Flags: `--engine=agentic|baseline|both`, `--subset=smoke|full`, `--version=gold-v1`, `--json-out=<path>`, `--score-only` (score fixture artifacts without live engines — for unit/CI without API keys).

---

## 6. CI wiring (daily + per-PR)

Two triggers, two jobs. Both keyed off the same harness.

**Per-PR gate** — sibling job (not blocking lint/test when secrets absent):
```yaml
- name: Gold-set eval (smoke subset)
  if: ${{ secrets.OPENAI_API_KEY_EVAL != '' }}
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY_EVAL }}
    DEID_ENABLED: "false"
  run: npm run eval:gold:fast
```
Purpose: no prompt change, model swap, or agentic-tool edit silently degrades clinical quality. Runs the smoke subset (~8–10 fastest representative cases; start with 2–3 samples) to keep PR latency/cost bounded.

**Always-on without secrets:** unit tests cover schema validation + deterministic safety assertion helpers (`npm test`). Existing `npm run eval:harness` remains the contract/critic gate.

**Nightly full run** — new `.github/workflows/gold-evals.yml`:
```yaml
name: Gold-set eval (nightly)
on:
  schedule: [{ cron: "0 6 * * *" }]   # 06:00 UTC
  workflow_dispatch:
jobs:
  gold-eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm install --no-audit --no-fund
      - name: Run full gold-set eval (both engines)
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY_EVAL }}
          DEID_ENABLED: "false"
        run: npm run eval:gold -- --engine=both --subset=full --json-out=gold-report.json
      - name: Persist scorecard
        run: node scripts/persist-gold-report.js gold-report.json   # → trends table (§8)
      - name: Notify
        if: always()
        run: node scripts/notify-gold-report.js gold-report.json     # Slack / Command Center
```
Purpose: (a) longitudinal trend = the SEC-102 progress chart; (b) **model-drift detection** — same code, provider updates the model behind the API, quality moves; nightly catches it.

> **Cost/PHI note for CI:** the gold cases committed to the repo are de-identified/synthetic by construction (§2), so running them in GitHub-hosted CI is acceptable. Judge + engine calls cost real LLM spend — budget the smoke subset to stay cheap on every PR, full set once nightly.

---

## 7. Relationship to Phoenix (why not just use Arize Phoenix)

Phoenix stays for **run observability** (spans/traces, SEC-103) — it is not the quality gate. Two reasons:
1. **PHI boundary.** `phoenix.service.ts` enforces "never attach prompt or completion bodies (or any clinical text) to spans." A gold-set eval *is* clinical text; Phoenix Experiments would require uploading it as a dataset — forbidden. (Corollary: because we strip clinical text from prod spans, Phoenix trace-based eval also can't grade clinical correctness of live runs — the content isn't there.)
2. **CI gating fits code, not a hosted async service.** The gate must fail a build synchronously with an exit code; Phoenix experiments are built for exploration/comparison.

Optional, later: push **synthetic-only** scorecards to Phoenix for a trend dashboard. Real de-identified gold cases never leave git.

Division of labor: **Phoenix = "what did the agent do." Gold harness = "was it clinically right and safe."**

---

## 8. Trend persistence + sign-off surface

- New table `gold_eval_runs` (migration `032_gold_eval_runs.sql`): `id, gold_set_version, engine, mean_correctness, safety_pass_rate, mean_quality, git_sha, judge_model, created_at`. One row per engine per run.
- Command Center read view (reuse `commandCenter.routes.ts` / `commandCenter.service.ts`) charting correctness/safety/quality over time for both engines — the human-facing SEC-102 evidence.

**SEC-102 cutover checklist (clinician signs in Command Center):**
1. Gold-set correctness: agentic ≥ baseline. ☐
2. Safety pass-rate: agentic = 100%. ☐
3. Nightly trend: stable/improving over N weeks. ☐
4. Production shadow parity (`shadowParity.service.ts`): `favor_agentic` or `parity`, sufficient sample. ☐
5. Cost/latency within budget. ☐

All green → flip `ANALYSIS_EXECUTION_MODE=agentic`. Reversible in minutes (config toggle + baseline fallback).

---

## 9. Implementation phases

| Phase | Deliverable | Exit |
|-------|-------------|------|
| P0 | **Confirm deployed execution mode** — `GET /version` reports `analysisExecutionMode`; verify prod is actually `shadow` (see §10) | Mode observable + confirmed |
| 1 | Schema + `src/evals/gold/` + 2–3 synthetic sample cases + deterministic safety helpers | Cases load; unit tests green |
| 2 | Fixture injection on runners + `goldEvalHarness.ts` (engines + safety + judge) | Correctness/safety/quality per case |
| 3 | `run-gold-evals.ts` + npm scripts + exit-code gating | `eval:gold:fast` gates a PR (when secrets present) |
| 4 | CI: PR smoke step + nightly workflow | Nightly posts a scorecard |
| 5 | `gold_eval_runs` table + Command Center trend view | SEC-102 checklist renders |
| 6 | Clinical team authors the real 30–50-case gold set | `gold-v1` tagged, two-clinician signed |

Phases 1–5 are engineering and can proceed with synthetic placeholders. Phase 6 is the clinical long pole and can run in parallel from Phase 1.

---

## 10. Open questions / risks

- **P0 blocker:** is production actually in `shadow` mode? Railway may omit `ANALYSIS_EXECUTION_MODE` → code default is `baseline`, meaning agentic may not be running and **no shadow data is accumulating.** Confirm before relying on shadow parity as SEC-102 evidence. Add the mode to `/version` (this ticket).
- **Engine DB coupling:** runners require fixtures + `persist:false` (see §3.1) — without this, CI cannot invoke real engines.
- **Judge reliability:** LLM-as-judge drifts. Mitigate with pinned model id + rubric versioning + deterministic recall signals; periodically spot-check judge scores against clinician grades.
- **Gold-set staleness:** medicine changes; schedule a quarterly clinician review of references.
- **Cost:** full nightly run × 2 engines × judge calls. Budget and cap; keep PR subset small; skip live gold job when `OPENAI_API_KEY_EVAL` is unset.
- **Small-n statistics:** 30–50 cases means noisy percentages. Report deltas with caution; lean on the trend, not a single run.
- **AI contract alignment:** gold references must not expect the engine to issue diagnoses or treatment orders.

---

## 11. Review notes (2026-08-09)

| Finding | Resolution |
|---------|------------|
| Spec had `SEC-XXX` placeholder | Created **SEC-205**; renamed this doc |
| Migration `03X` | Use **`032_gold_eval_runs.sql`** (after `031_organization_invites`) |
| `/version` missing execution mode | P0: add `analysisExecutionMode` via `resolveExecutionMode()` |
| "Call real entry points" without adapter | Document fixture + `persist:false` path (§3.1) |
| "Strong Claude" vs OpenAI gateway | Pin approved gateway model |
| CI has no eval API key today | Conditionally run live smoke; unit-test deterministic pieces always |
| Sample reference used order-language | Prefer discussion framing for AI_CONTRACT compatibility |
| Existing `eval:harness` | Remains contract/critic only; gold is complementary |

---

## 12. Current delivery slice

- [x] Spec reviewed + linked to SEC-205
- [x] P0: `/version` exposes `analysisExecutionMode`
- [x] Phase 1: Zod schema, loader, 3 synthetic smoke cases, deterministic safety assertion helper + unit tests
- [x] Phase 2: fixture injection (`fixtures` + `persist:false`) on baseline + agentic runners; `goldEvalHarness.ts`
- [x] Phase 4: PR smoke CI + nightly workflow
- [x] Phase 5: migration `032` + Command Center `/admin/gold-evals` trend view
- [ ] Phase 6: clinical gold-v1 authorship
- [ ] Confirm prod `analysisExecutionMode` via `/version` after deploy
