# Agent Run Ledger

This ledger is the durable audit trail for agent-assisted work in the SecondOp backend repository. It is intentionally file-first so it is visible in GitHub reviews and does not depend on chat history or local machine state.

## Ledger Rules

- Add one entry for each agent run that touches this repository.
- Keep entries concise, factual, and sanitized.
- Do not record secrets, tokens, OTPs, credentials, raw auth URLs, private environment values, patient data, or sensitive logs.
- Record blockers honestly, including environment, permission, CI, deployment, migration, database, or approval blockers.
- Link Linear issues and GitHub PRs when available.
- If a run spans multiple repositories, summarize the backend portion here and reference related frontend/root work.

## Entry Template

```md
## YYYY-MM-DD - SEC-000 - Short title

- Status:
- Human approval:
- Branch/worktree:
- Files changed:
- PR:
- Checks:
- Deployment:
- Verification:
- Blockers:
- Follow-ups:
```

## 2026-08-05 - SEC-201 - Primary domain secondop.ai

- Status: Implementation on feature branch; awaiting draft PR + human merge/deploy.
- Human approval: Required before merge/deploy. Railway must set `APP_PUBLIC_URL=https://secondop.ai` and CORS to include `https://secondop.ai` (optionally keep `https://secondop.in` during cutover).
- Branch/worktree: `sec-201-secondop-ai-primary`
- Files changed: PDF footer brand, service-health default FE URL, CORS unit examples, `.env.example`, runbook/phoenix docs, ledger
- PR: (pending)
- Checks: pending
- Deployment: Not started — FE companion PR owns `vercel.json` `.in` → `.ai` redirects
- Verification: unit CORS parse still green after domain swap
- Blockers: Vercel must attach `secondop.ai` as primary; DNS for `.in` must stay on Vercel for redirects to fire
- Follow-ups: Update Railway prod `CORS_ORIGIN` / `SOCKET_IO_CORS_ORIGIN` / `APP_PUBLIC_URL`; mailboxes for `@secondop.ai`

## 2026-08-05 - SEC-199 - Lock production signup (approval gate)

- Status: Implementation complete on feature branch; awaiting draft PR + human merge/deploy approval.
- Human approval: Required before merge/deploy. Production needs `API_PUBLIC_URL` set for one-click approve links.
- Branch/worktree: `sec-199-signup-approval-gate`
- Files changed: `signupApproval.service.ts` (new), `auth.controller.ts`, `auth.routes.ts`, `email.service.ts`, `.env.example`, `signup-approval*.test.ts`, this ledger
- PR: (pending)
- Checks: `npm test -- --testPathPattern='signup-approval'` (9 passed); lint/build pending in this run
- Deployment: Not started — gate defaults on when `NODE_ENV=production`
- Verification: register with gate → `pendingApproval`, no tokens/welcome; approve HTML path; ops notify email builder
- Blockers: None for code; deploy needs Railway `API_PUBLIC_URL` + optional explicit `SIGNUP_REQUIRES_APPROVAL=true`
- Follow-ups: FE companion PR; after merge set prod env and smoke register → Vinodh approve email → welcome

## 2026-08-05 - SEC-198 - Doctor opinion E2E P0–P2 fixes

- Status: Implementation complete on feature branch; awaiting draft PR + human merge approval.
- Human approval: Required before merge/deploy.
- Branch/worktree: `sec-198-doctor-opinion-e2e-fixes`
- Files changed: `case.controller.ts` (status UPDATE `$1::text` cast; open-cases stats), `extractedReportSanitize.service.ts` (PDF operator junk + citation sanitize), `analysisArtifact.service.ts` (filter junk evidence_refs), `doctor-response.test.ts`, `extracted-report-sanitize.test.ts`, this ledger
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/103 ; FE https://github.com/SecondOP-Org/secondop-frontend/pull/142
- Checks: `npm run lint`; `npm test -- --testPathPattern='doctor-response|extracted-report-sanitize'` (22 passed); `npm run build`
- Deployment: Not started (P0 prod send-500 needs deploy after merge)
- Verification: unit coverage for `$1::text` cast and PDF-operator junk rejection
- Blockers: none for code; prod case `c9fce3de` orphaned `doctor_opinion` messages need ops cleanup after deploy
- Follow-ups: FE sibling PR for AI-draft replace, cite sanitize, preview open-in-tab, dashboard labels, patient plain register; seed typo "panic attacs" not in repo seeds (prod data only)

## 2026-08-04 - SEC-194 - Official SecondOp S logo in PDF letterhead

- Status: Implementation complete on feature branch; awaiting draft PR + human merge approval.
- Human approval: Required before merge/deploy.
- Branch/worktree: `sec-194-official-s-logo`
- Files changed: `assets/secondop-logo.png`, `assets/secondop-mark.svg`, `doctorOpinionPdf.service.ts` (logo comments + fallback tile color), this ledger entry
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/102 ; FE https://github.com/SecondOP-Org/secondop-frontend/pull/136
- Checks: `npm test -- --testPathPattern=doctorOpinionPdf` (14 passed); `npm run lint`
- Deployment: Not started
- Verification: `resolveLogoPath` still resolves `assets/secondop-logo.png`; letterhead embeds new S mark
- Blockers: None for backend code; FE companion swaps chrome + home PDF sample
- Follow-ups: Merge with FE PR; regenerate a sample opinion PDF for visual QA

## 2026-08-04 - SEC-190 - Doctor opinion comprehensive report (backend)

- Status: Backend implementation complete on feature branch; awaiting FE companion + draft PR.
- Human approval: Required before merge/deploy.
- Branch/worktree: `sec-190-doctor-opinion-report`
- Files changed: `doctorResponse.schema.ts` (structured sections + send gates); `doctorResponse.service.ts` (merge/validate/compose + records helper); `doctorOpinionPdf.service.ts` (customer headings, no name redaction, de-dup report date); `case.controller.ts` (pdfInput fields); `patientFacingDraft.service.ts` + schema (section draft kinds); PDF + doctor-response tests; this ledger entry
- PR: Not opened yet
- Checks: `npm test -- --testPathPattern='doctorOpinionPdf|doctor-response'` (29 passed); `npm run lint` (clean)
- Deployment: Not started
- Verification: Unit coverage for customer headings, full names, concordance/records/limitations, send validation
- Blockers: None for backend code; FE compose panel is companion work
- Follow-ups: FE DoctorResponsePanel sections + gates; signed sample PDF review; draft PR

## 2026-08-04 - SEC-189 - Plain-language patient register (dual register)

- Status: Implementation complete; draft PR pending human merge approval.
- Human approval: Required before merge/deploy.
- Branch/worktree: `sec-189-patient-summary-register`
- Files changed: `analysisArtifact.service.ts` (`PatientSummary` + hydrate/build); `analysis.service.ts` (prompts/schema/parse); `analysisDeidentification.service.ts`; `contractChecks.ts`; `docs/AI_CONTRACT.md`; tests; agentic empty stub; companion FE PR for role-based rendering + landing SVG
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/100 ; FE https://github.com/SecondOP-Org/secondop-frontend/pull/131
- Checks: `npm test`, `npm run eval:harness`, `tsc --noEmit`
- Deployment: Not started
- Verification: Contract co-presence + forbidden-claim coverage for plain register; FE unit tests for patient/doctor views
- Blockers: None for code
- Follow-ups: Re-run analysis on existing cases to populate `patient_summary`; merge FE companion PR together

## 2026-08-03 - SEC-26 - Deployment runbook exception + rollback

- Status: Implementation complete; draft PR pending human merge approval.
- Human approval: Required before merge (docs only).
- Branch/worktree: `sec-26-deployment-runbook-exception`
- Files changed: `docs/DEPLOYMENT_RUNBOOK.md` (versioned copy of workspace runbook §0 exception, rollback detail, Linear/GitHub updates); `.cursor/skills/secondop-deploy/SKILL.md`
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/99
- Checks: Docs review only
- Deployment: Not started
- Verification: Dry-run checklist language against 2026-06-23 direct-to-prod event
- Blockers: None
- Follow-ups: Keep workspace root `DEPLOYMENT_RUNBOOK.md` in sync with this copy

## 2026-08-03 - SEC-185 - Jane Doe demo intake sex consistency

- Status: Implementation complete; draft PR pending human merge approval.
- Human approval: Required before merge/deploy.
- Branch/worktree: `sec-185-demo-intake-sex`
- Files changed: `src/services/demoData.service.ts` (correct demo Jane Doe `case_intake.sex` to female); `src/__tests__/demo-data.service.test.ts`
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/98
- Checks: unit test for ensureDemoData
- Deployment: Not started
- Verification: Pending after merge + demo bootstrap on target env
- Blockers: None for code; prod correction runs on next `ensureDemoData` boot when enabled
- Follow-ups: Frontend demographics display helper in companion FE PR

## 2026-07-29 - SEC-170 - Org invites + admin org verification

- Status: Merged and deployed (staging + production).
- Human approval: User requested merge and deploy.
- Branch/worktree: merged via BE #96 / FE #114 onto `main`.
- Files changed: migration `031_organization_invites.sql`; org invite APIs; auth `inviteToken`; admin org verification; FE portal + `/accept-invite`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/96 ; FE https://github.com/SecondOP-Org/secondop-frontend/pull/114
- Checks: BE/FE CI green before merge
- Deployment: Railway staging+prod redeploy `--from-source` @ `cd7e51a`; Vercel prod → https://secondop.in; migrations 030+031 applied (idempotent)
- Verification: `/health` ok; invite preview 404 for bogus token; CORS allow-origin secondop.in; `/accept-invite` 200
- Blockers: none
- Follow-ups: `/version` still reports stale `gitSha` build metadata (runtime routes confirm SEC-170 live)

## 2026-07-29 - SEC-174 - Unified canSignOpinion gate (doctor + org)

- Status: In progress (draft PR).
- Human approval: User asked to work next hybrid item after §1.
- Branch/worktree: `sec-174-unified-cansign-gate` (stacked on SEC-173).
- Files changed: `doctorVerification.service.ts` (`canSignOpinion` / `assertCanSignOpinion` + JOIN orgs); assign/sign use helpers; tests for solo + org-member cases.
- PR: TBD
- Checks: pending
- Deployment: not yet; depends on SEC-173 merge + migration 030
- Verification: pending
- Blockers: stacked on SEC-173 / PR #94
- Follow-ups: SEC-170 org invites

## 2026-07-29 - SEC-173 - Hybrid §1 organizations foundation

- Status: In progress (foundation PR).
- Human approval: User asked to implement hybrid doctor/provider signup + verification spec; sequenced per §7 (this run = §1 only).
- Branch/worktree: `sec-173-hybrid-org-foundation` (backend); FE `sec-173-hybrid-org-signup`.
- Files changed: migration `030_organizations_hybrid.sql`; `organization.service.ts` + routes/controller; auth register `userType=organization`; JWT/auth user types include organization; tests for parse/create pending org.
- PR: TBD
- Checks: pending
- Deployment: not yet
- Verification: pending
- Blockers: none for coding; merge/deploy wait human approval
- Follow-ups: SEC-174 unified gate; SEC-170 org invites (stance A)

## 2026-07-29 - SEC-169 - Doctor signup credential verification gate

- Status: Merged + deployed (staging + production).
- Human approval: User tasked `DOCTOR_SIGNUP_VERIFICATION_SPEC.md` Phase 1, then approved merge and deploy.
- Branch/worktree: `sec-169-doctor-signup-credential-verification` (backend); FE `sec-169-doctor-credential-verification`.
- Files changed: migration `029_doctor_credential_verification.sql`; `doctorVerification.service.ts` + admin controller/routes; auth register credential fields + `pending`; case assign + opinion-sign 403 gates; profile fields; demo/seed backfill `verified`; public doctor listing also requires `verification_status=verified`; tests.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/93 (FE: https://github.com/SecondOP-Org/secondop-frontend/pull/109)
- Checks: targeted jest (`doctor-credential-verification`, `doctor-response`, `demo-data`); lint; build; CI green.
- Deployment: Railway staging + production redeployed after applying migration 029 to staging Postgres-k0Us and production Postgres. Initial post-merge deploy crashed on missing `registration_council` during `ensureDemoData` until migrate ran. FE Vercel production Ready at https://secondop.in.
- Verification: staging/production `/health` 200; secondop.in 200.
- Blockers: none remaining after migrate + redeploy.
- Follow-ups: Phase 2 org/team (SEC-170); optional admin UI beyond operator API; automated registry lookup later.

## 2026-07-24 - SEC-162 - Opinion PDF body must not overlay footer

- Status: Merged (PR #92).
- Human approval: User reported overlay on prod case PDF and asked to check and fix.
- Branch/worktree: `sec-162-pdf-footer-overlay`.
- Files changed: `src/services/doctorOpinionPdf.service.ts` (bottom margin includes footer band; larger FOOTER_RESERVED; callout/Q&A pagination fixes); PDF unit tests; ledger.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/92
- Checks: `npm test -- --testPathPattern=doctorOpinionPdf.service.test`; lint; build.
- Deployment: pending production deploy.
- Verification: long-content PDF paginates (Page 1 of N, N>1) with CONFIDENTIAL footer retained.
- Blockers: none
- Follow-ups: regenerate/preview PDF for case ecee6762… after deploy.

## 2026-07-24 - SEC-161 - Patient-facing case ref never GUID

- Status: Merged (PR #91, rebased after SEC-162).
- Human approval: User requested PDF/customer docs must not show GUID case numbers.
- Branch/worktree: `sec-161-patient-facing-case-ref`.
- Files changed: `src/utils/caseNumber.ts` (`toPatientFacingCaseRef`); `doctorOpinionPdf.service.ts`; `imagingStudyDownload.service.ts`; tests; ledger.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/91
- Checks: targeted jest + lint + build passed.
- Deployment: pending production deploy.
- Verification: PDF with `SO-{uuid}` asserts short `SO-XXXXXXXX` only.
- Blockers: none
- Follow-ups: optional DB backfill of legacy `case_number` (out of scope).

## 2026-07-23 - SEC-145 - Evidence chip reject OCR/nav junk

- Status: Rebased onto main; merging PR #88.
- Human approval: User approved merge of remaining conflicted PRs.
- Branch/worktree: `sec-145-evidence-chip-reject-ocr-junk`.
- Files changed: `extractedReportSanitize.service.ts` (new), `reportExtraction.service.ts`, `analysisArtifact.service.ts`, `extracted-report-sanitize.test.ts`, ledger.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/88
- Checks: lint / test / build.
- Deployment: pending with this merge.
- Verification: unit coverage of junk chip + groundedness; live case re-analysis not run here.
- Blockers: none.
- Follow-ups: re-run analysis on junk-chip case then re-capture `ai-summary.jpg` (SEC-148).

## 2026-07-23 - SEC-154 - Opinion PDF icon, hide GUID, redact last names

- Status: Ready for review.
- Human approval: Pending merge approval.
- Branch/worktree: `sec-154-opinion-pdf-icon-guid-redact`.
- Files changed: `src/services/doctorOpinionPdf.service.ts` (app brand mark PNG 256px + vector fallback; remove Report ID from letterhead/footer; redact patient/doctor last names as `[REDACTED]`); `assets/secondop-logo.png` + `assets/secondop-mark.svg`; PDF unit tests; ledger.
- PR: (pending)
- Checks: `npm test -- --testPathPattern=doctorOpinionPdf.service.test`, `npm run lint`, `npm run build` passed.
- Deployment: none.
- Verification: Unit coverage for logo path, no GUID/Report ID, redacted names, signedAt date preserved.
- Blockers: none
- Follow-ups: SEC-152 canonical brand across FE/favicon still product-decision blocked; local BE nodemon may need restart to pick up assets.

## 2026-07-22 - SEC-137 - Patient profile PUT fields for persistence

- Status: Merged and deployed (staging + production).
- Human approval: User said merge and deploy.
- Branch/worktree: `sec-137-patient-profile-upload-inr-pay` → `main` @ `8a727f8`.
- Files changed: `src/controllers/user.controller.ts` (GET/PUT patient profile includes emergency contacts, allergies, medications, medical conditions); ledger.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/87 (FE: https://github.com/SecondOP-Org/secondop-frontend/pull/87 → `4d2b011`)
- Checks: BE CI green on PR; local lint/build green; FE CI green.
- Deployment: Railway staging `6688af2e` + production `4b5a7439`; Vercel production promote `secondop-frontend` (`dpl_DrMuagYaoedw8K7rRsExGdrXnMex` → secondop.in) + `secondop-fe-deploy`.
- Verification: staging/prod `/health` 200; prod CORS allows `https://secondop.in`; `secondop.in` 200; unauth patient profile route 401 (route present). Full logged-in UI smoke not run here.
- Blockers: none
- Follow-ups: gitSha metadata still reports older SHA on Railway `/version` (pre-existing; deploy IDs confirm new releases).

## 2026-07-19 - SEC-104 - Production Presidio fetch failed (closeout)

- Status: Verified + documented; marking Done.
- Human approval: User said next after SEC-130.
- Branch/worktree: `sec-104-presidio-docs`.
- Files changed: `docs/PRESIDIO_PRODUCTION.md`, ledger; workspace runbook §8c (local).
- PR: (pending)
- Checks: Prod analyzer/anonymizer `/health` 200; `POST /analyze` returns PERSON; backend runtime `fetch(PRESIDIO_ANALYZER_URL/health)` ok; `DEID_*` + `PRESIDIO_*` keys present on staging/prod.
- Deployment: Config already applied (no new deploy required for closeout).
- Verification: Full patient UI re-run of analysis not executed here; connectivity path that caused `fetch failed` is confirmed fixed.
- Blockers: none
- Follow-ups: Prefer private DNS for prod Presidio URLs.

## 2026-07-19 - SEC-130 - Enable IMAGE_DEID (Railway image-redactor)

- Status: Sidecars deployed; flag enabled on staging + production.
- Human approval: User said proceed on SEC-129 follow-up (enable IMAGE_DEID).
- Branch/worktree: `sec-130-enable-image-deid` (Dockerfile/libGL + spaCy fix; docs).
- Files changed: `presidio-image-redactor/Dockerfile`, `requirements.txt`, `railway.toml`; runbook section 8c.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/85 → `579d43c`
- Checks: Sidecar staging+prod `/health` 200; `POST /redact-image` 200; backend staging+prod `/health` 200 after env set.
- Deployment: Railway services `secondop-presidio-image-redactor-staging` + `secondop-presidio-image-redactor`; `IMAGE_DEID_ENABLED=true` + `PRESIDIO_IMAGE_REDACTOR_URL` on both backends.
- Verification: Blank PNG redact smoke (entity_count 0 / skipped); full burned-in PHI fixture validation still recommended.
- Blockers: none
- Follow-ups: Real fixture quality check; prefer private DNS for redactor URLs.

## 2026-07-19 - SEC-129 - Image/DICOM pixel PHI redaction

- Status: Merged and deployed (staging + production).
- Human approval: User approved merge and deploy.
- Branch/worktree: `sec-129-image-pixel-phi-redaction` → `main` @ `04a8b9a`.
- Files changed: `presidio-image-redactor/` sidecar, `imageRedaction.service.ts`, upload + imaging ingest wiring, `documentExtraction` defense-in-depth, compose `deid` profile, `IMAGE_DEID_ENABLED` env (default false), `image_phi_redactions_total` counter, unit tests.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/83
- Checks: CI green; local lint/test/build green.
- Deployment: Railway staging `e176d46c` + production `aef58a52` from `04a8b9a`; `IMAGE_DEID_ENABLED` unset (ship dark / default off). No new DB migrations.
- Verification: staging + prod `/health` 200.
- Blockers: none
- Follow-ups: Validate redaction on real fixtures before enabling `IMAGE_DEID_ENABLED`; provision image-redactor sidecar on Railway when enabling.

## 2026-07-18 - SEC-126 - Download imaging study as .zip for native workstation

- Status: Merged and deployed (staging + production).
- Human approval: User approved merge and deploy.
- Branch/worktree: `sec-126-download-imaging-study-zip` (backend + frontend).
- Files changed: `imagingStudyDownload.service.ts`, `file.controller.ts`, `case.routes.ts`, migration `028_imaging_study_download_audit.sql`, FE `files.ts` + Imaging download UI.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/82 · FE https://github.com/SecondOP-Org/secondop-frontend/pull/78
- Checks: BE CI green; FE CI green; post-deploy route probe 401 (auth required) on prod+staging download endpoint; `/health` 200; FE https://secondop.in 200.
- Deployment: Railway `secondop-backend` + `secondop-backend-staging` redeployed from source; migration 028 applied to prod Postgres and staging Postgres-k0Us; Vercel production aliased to https://secondop.in.
- Verification: Remaining manual — assigned doctor downloads 303-slice study → native viewer; tags de-identified.
- Blockers: none
- Follow-ups: Representative-slice open-frame / NaN size viewer polish (separate ticket); no MPR/3D in-app.

## 2026-07-18 - SEC-125 - Patient-facing AI draft voice

- Status: Merged and deployed.
- Human approval: Explicit merge + deploy approval.
- Branch/worktree: `sec-125-patient-facing-draft-voice` → `main`.
- Files changed: `patientFacingDraft.service.ts` (Option A LLM + Option B template), `POST /doctor-response/ai-draft`, PDF `Dear [First name],` salutation; FE Insert AI draft for answers + summary; forbidden-claim/grounding checks on prose.
- PR: BE https://github.com/SecondOP-Org/secondop-backend-agentic/pull/81 ; FE https://github.com/SecondOP-Org/secondop-frontend/pull/77
- Checks: CI green on both PRs; local lint/build/unit tests passed.
- Deployment: Railway staging `b589e57f` + production `a869aa8e` on commit `b479346`; Vercel production FE `9bb2a19`.
- Verification: `/health` ok; ai-draft route returns 401 (auth required) not 404 on staging/prod.
- Blockers: `/version` gitSha lag observed (deployment meta shows correct commit).
- Follow-ups: none

## 2026-07-17 - SEC-124 - Patient-facing analysis failure UX (PC4)

- Status: Draft PR pending.
- Human approval: User ordered PC1→PC2→PC4→PC3.
- Branch/worktree: `sec-124-patient-failure-ux` (BE stacked on SEC-122).
- Files changed: `getCaseAnalysis` adds `analysisRetrying` (hides retry raw error); FE friendly fail + Try again + Continue without AI; retrying copy while processing.
- PR: (pending)
- Checks: BE/FE build.
- Deployment: After PC1+PC2 for retrying flag accuracy.
- Verification: Terminal fail never shows raw typed error; mid-retry shows longer-than-usual.
- Blockers: Human merge approval.
- Follow-ups: SEC-123 per-case latency span/log.

## 2026-07-17 - SEC-122 - Per-case attention_reason + doctor banner + ops (PC2)

- Status: Draft PR pending human merge approval.
- Human approval: User ordered PC1→PC2→PC4→PC3.
- Branch/worktree: `sec-122-attention-reason` (stacked on SEC-121).
- Files changed: migration `027_analysis_run_attention_reason.sql`, `analysisAttention.service.ts`, `markAnalysisRunSucceeded/Failed` attention writes, case APIs (`attentionReason` / `analysis_attention_reason`), `GET /admin/analysis-runs`, FE doctor banner + Analysis Observability column/filter + `/admin/analysis-attention` fleet view.
- PR: (pending)
- Checks: attention unit tests + lint + tsc; FE lint/build.
- Deployment: Needs migrations 026+027; depends on SEC-121 for `retried`.
- Verification: low_confidence banner on doctor case; ops fleet filterable by attention_reason.
- Blockers: Merge/deploy need human approval; prefer merge SEC-121 first.
- Follow-ups: SEC-124 patient failure UX; SEC-123 per-case latency span/log.

## 2026-07-17 - SEC-121 - Bounded automatic retry on transient analysis failure (PC1)

- Status: Draft PR pending human merge approval.
- Human approval: User ordered PC1→PC2→PC4→PC3 per-case resilience spec.
- Branch/worktree: `sec-121-analysis-transient-retry`.
- Files changed: migration `026_analysis_run_attempt_count.sql`, `analysisFailureClassifier.service.ts`, `analysisRun.service.ts` (`prepareAnalysisRunForRetry`, `attempt_count`), `analysisWorker.service.ts` (requeue with backoff, keep case `processing`), Phoenix `retries_total`, classifier unit tests; db migrate scripts.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/76
- Checks: classifier unit tests + lint + `tsc` build locally.
- Deployment: None yet; needs migration 026 on deploy.
- Verification: RETRYABLE (Presidio/de-id outage, timeout) requeues up to 2 retries; TERMINAL (validation/grounding) does not; patient status stays `processing` while retrying.
- Blockers: Merge/deploy need human approval.
- Follow-ups: SEC-122 attention_reason; SEC-124 patient failure UX; SEC-123 per-case latency signal.

## 2026-07-17 - SEC-116 - Log↔trace correlation (runId + trace_id)

- Status: Draft PR pending.
- Human approval: User asked merge SEC-111 then continue backlog; batch deploy later.
- Branch/worktree: `sec-116-log-trace-correlation`.
- Files changed: `logContext.ts`, winston inject format, `getActiveTraceId`, analysisWorker wrappers, tests.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/75
- Checks: unit tests for ALS + winston metadata.
- Deployment: Deferred (batch).
- Verification: runId always in analysis-path logs; trace_id when Phoenix span active.
- Blockers: None.
- Follow-ups: SEC-118 blocked on video asset; SEC-119 human Phoenix password.

## 2026-07-17 - SEC-111 - Doctor-edit distance (ai_draft_edit_ratio)

- Status: Draft PR open; awaiting human merge approval.
- Human approval: User approved merge of ready work; batch deploy later.
- Branch/worktree: `sec-111-doctor-edit-distance`.
- Files changed: migration `025_ai_draft_edit_ratio.sql`, `doctorEditDistance.service.ts`, draft schema `aiDraftBaselines`, send-opinion hook + Phoenix `doctor.opinion.send` span, FE Insert AI draft capture.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/72 (FE pending)
- Checks: unit tests + lint locally.
- Deployment: Deferred (batch; run migrations 024+025).
- Verification: Unit edit-distance edge cases; FE persists baselines on insert/autosave/send.
- Blockers: None for merge of SEC-108 (done).
- Follow-ups: Remaining backlog A3/A4/B4/C2–C4/D2; batch deploy.

## 2026-07-17 - SEC-108 - Online evals on production traces

- Status: Merged to main.
- Human approval: User asked merge then continue; batch deploy later.
- Branch/worktree: `sec-108-online-evals`.
- Files changed: migration `024_analysis_run_online_evals.sql`, `onlineEvals.service.ts`, `contractChecks` groundedness helper, `markAnalysisRunSucceeded` columns, worker + persist-results hooks, tests.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/71
- Checks: Backend CI passed after orchestrator expectation fix.
- Deployment: Deferred (batch with subsequent tickets; run migration 024).
- Verification: Unit tests for signals + span attrs; no new LLM calls.
- Blockers: None for code; merge approval + later batch deploy.
- Follow-ups: SEC-111 doctor-edit distance; then remaining backlog; batch deploy.

## 2026-07-17 - SEC-109 - Shadow-parity report

- Status: Implementing; draft PR pending human merge approval.
- Human approval: User ordered B1 after SEC-112 deploy.
- Branch/worktree: `sec-109-shadow-parity-report` (BE + FE).
- Files changed: `shadowParity.service.ts`, controller/route mount, FE dashboard `/admin/shadow-parity`, unit tests.
- PR: (pending)
- Checks: (pending)
- Deployment: None yet.
- Verification: Aggregation unit tests; operator-gated endpoint.
- Blockers: None for code; merge/deploy need human approval. SEC-102 remains decision-blocked until enough shadow pairs + human review of verdict.
- Follow-ups: SEC-117 imaging UX; human SEC-102 promotion decision.

## 2026-07-17 - SEC-112 - SLO / fail-closed webhook alerts

- Status: Implementing; draft PR pending human merge approval.
- Human approval: User ordered A2 after SEC-110 deploy.
- Branch/worktree: `sec-112-slo-alerting-webhook`.
- Files changed: `analysisAlerting.service.ts`, `analysisWorker.service.ts` (terminal hooks), `.env.example` (`ALERT_WEBHOOK_URL`), unit tests.
- PR: (pending)
- Checks: (pending)
- Deployment: None yet; set `ALERT_WEBHOOK_URL` on Railway after merge.
- Verification: Unit tests for thresholds + fail-closed immediate post.
- Blockers: None for code; merge/deploy + webhook secret need human approval.
- Follow-ups: SEC-109 shadow-parity report.

## 2026-07-17 - SEC-110 - Admin-gate analysis observability

- Status: Implementing; draft PR pending human merge approval.
- Human approval: User ordered A1 (SEC-110) first in consolidated backlog.
- Branch/worktree: `sec-110-admin-gate-observability`.
- Files changed: `commandCenterAuth.ts` (`isCommandCenterOperator`), `case.routes.ts` (operator on `/analysis/trace`), `case.controller.ts` (`includeAgentic` operator-only; trace without case ownership), role tests.
- PR: (pending)
- Checks: lint; targeted jest (case-analysis + command-center routes) pass.
- Deployment: None yet.
- Verification: Patient + non-allowlist → 403 on middleware; patient `includeAgentic` → 403; operator trace/includeAgentic → success.
- Blockers: None for code; merge/deploy need human approval.
- Follow-ups: SEC-112 SLO webhook alerts → SEC-109 shadow-parity → SEC-117 imaging UX.

## 2026-07-16 - SEC-107 - OpenInference span enrichment

- Status: Implementing; awaiting PR + human merge approval.
- Human approval: User asked to start next after SEC-106 deploy.
- Branch/worktree: `sec-107-openinference-span-enrichment`.
- Files changed: `phoenix.service.ts` (kind + nesting + counters), `eventEmitter.ts`, `agent.context.ts`, `runtime.ts`, `agent.orchestrator.ts`, `analysisWorker.service.ts`, `llmGateway.ts` (LLM child spans, PHI allowlist), `deidentification.service.ts` / `contractChecks.ts` counters, tests.
- PR: (pending)
- Checks: `tsc`, `npm test` (194), `lint`, `build`.
- Deployment: None yet.
- Verification: Unit test asserts CHAIN→TOOL→LLM nesting and `openinference.span.kind`; disabled path no-ops.
- Blockers: None.
- Follow-ups: SEC-108 online evals; sync Phoenix UI check after deploy.

## 2026-07-16 - SEC-106 - Agentic finalize de-id twin (P0 prod fix)

- Status: Merged + deployed to Railway production and staging.
- Human approval: User approved merge and deploy.
- Branch/worktree: `sec-106-agentic-finalize-deid-twin` → `main` (`e7b39f0`).
- Files changed: `analysis.service.ts` (return `artifactDeidentified`), `finalizer.agent.ts`, `critic.agent.ts`, baseline `question-guard.agent.ts` + `persist-results.agent.ts`, `question_guard.tool.ts` (twin sync), `agentic-finalize-deid-twin.test.ts`, `e2e-smoke.mjs` (`E2E_REQUIRE_AGENTIC_DEID`), fixtures.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/66
- Checks: `npx tsc --noEmit`; `npm test` (191 passed); `npm run lint`; `npm run eval:harness`; CI green on PR.
- Deployment: Railway production `secondop-backend` `c51d23f1…` SUCCESS (commit `e7b39f0`); staging `secondop-backend-staging` redeployed SUCCESS. No migrations. `/health` 200. `/version` `gitSha` may lag via stale `BACKEND_GIT_SHA` env.
- Verification: Deployment meta confirms SEC-106 commit live. Manual re-run on case `5151f76c-…` still recommended for end-to-end confirm.
- Blockers: None for merge/deploy.
- Follow-ups: SEC-107 OpenInference spans → SEC-108 online evals → SEC-110 ops → SEC-109 shadow parity → SEC-111 edit distance; optionally sync Railway `BACKEND_GIT_SHA`.

## 2026-07-16 - SEC-105 - Service Health dashboard

- Status: Implementing; awaiting PR + human merge approval.
- Human approval: User approved plan implementation.
- Branch/worktree: `sec-105-service-health-dashboard`.
- Files changed: `serviceHealth.service.ts`, controller, command-center route mount, tests, `.env.example`; FE dashboard + routes (sibling repo).
- PR: (pending)
- Checks: `npm test -- --testPathPattern=service-health` passed.
- Deployment: Do not set Railway `SERVICE_HEALTH_TARGETS` until merge approval; defaults cover production surfaces.
- Verification: Operator opens `/admin/service-health` after deploy.
- Blockers: Merge/deploy approval.
- Follow-ups: Optional Railway `SERVICE_HEALTH_TARGETS` for staging FE URL; prefer private Presidio DNS later.

## 2026-07-16 - SEC-103 - Production Phoenix tracing

- Status: In progress / deploying.
- Human approval: Explicit request to enable Phoenix in production.
- Branch/worktree: `sec-103-phoenix-production`.
- Files changed: add `@arizeai/phoenix-otel` + `@opentelemetry/api`; `docs/PHOENIX_TRACING.md`.
- Infra: Railway service `secondop-phoenix` + Postgres `Postgres-I7v9`; backend `PHOENIX_*` env set.
- PR: (pending)
- Checks: deps resolve locally; Phoenix UI HTTP 200; backend health 200 after redeploy.
- Deployment: Phoenix UI https://secondop-phoenix-production.up.railway.app ; backend redeploy after merge.
- Verification: pending analysis run span in project `secondop-agent-analysis`.
- Blockers: none.
- Follow-ups: staging mirror; rotate admin password / API keys if leaked in tooling logs.

## 2026-07-16 - SEC-100 - Workspace onboarding documentation spine

- Status: Merged + production deployed.
- Human approval: Merge and deploy approved.
- Branch/worktree: `sec-100-docs-spine` → `main` (`aa09140`).
- Files changed: `ARCHITECTURE.md`, `README.md`, `QUICKSTART.md`, `docs/decisions/*`, `src/*/README.md`, `scripts/setup-db.sh`, `scripts/seed-db.sh`, `.env.example` (`PORT=8081`, `DB_PASSWORD=postgres`), `src/server.ts` default port; removed root `*_TODO.md` / Presidio / Option A specs.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/63 (merged); FE companion https://github.com/SecondOP-Org/secondop-frontend/pull/66 (merged).
- Checks: lint; CI green; quickstart verified locally.
- Deployment: Railway production `secondop-backend` SUCCESS (`ee132684…`); FE Vercel production https://secondop.in auto-deploy after merge. No migrations.
- Verification: Prod `/health` + `/version` HTTP 200; FE `secondop.in` serves app shell.
- Blockers: none for this issue.
- Follow-ups: [SEC-102](https://linear.app/secondop/issue/SEC-102) shadow-parity gate; consider syncing Railway `BACKEND_GIT_SHA` with deploy SHA (env currently may lag).

## 2026-07-15 - SEC-97 - Signup timeout from blocking SMTP

- Status: PR created / needs merge approval.
- Human approval: Pending.
- Branch/worktree: `sec-97-signup-smtp-timeout`.
- Files changed: `email.service.ts` (SMTP timeouts + `queueEmail`), `auth.controller.ts` (register/forgot-password non-blocking), tests, `.env.example`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/62 (draft)
- Checks: lint; email + auth-security tests; build.
- Deployment: Backend-only; no migration.
- Verification: Signup returns before SMTP completes; FE no longer hits 30s timeout when Gmail hangs.
- Blockers: Needs merge + Railway deploy to fix production signup.
- Follow-ups: Confirm Gmail delivery from Railway; consider Resend/SES if SMTP remains blocked.

## 2026-07-15 - SEC-96 - Email delivery (welcome/verify + password reset)

- Status: Merged and deployed (`ea1e27c`).
- Human approval: Approved (prior session).
- Branch/worktree: `sec-96-email-delivery`.
- Files changed: `email.service.ts`, auth controller/routes, migration `023_widen_otp_code.sql`, `.env.example`, tests.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/61; FE https://github.com/SecondOP-Org/secondop-frontend/pull/64 (includes SEC-95 signup).
- Checks: lint; email + auth-security tests; build.
- Deployment: Requires `SMTP_*`, `EMAIL_FROM`, `APP_PUBLIC_URL` on Railway; migration 023 applied.
- Verification: With SMTP configured, register queues welcome/verify; forgot-password queues reset link; `/auth/verify-email` marks verified.
- Blockers: None for merge; SEC-97 addresses signup timeout when SMTP hangs.
- Follow-ups: Confirm delivery from Railway; optional harden verify-before-login later.

## 2026-07-15 - SEC-94 - Honest server-side imaging skip reporting

- Status: PR created / needs merge approval.
- Human approval: Pending.
- Branch/worktree: `sec-94-imaging-honest-skips`.
- Files changed: `src/services/imagingStudyIngest.service.ts`, `src/__tests__/imaging-study-collect.test.ts`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/60 (draft); FE https://github.com/SecondOP-Org/secondop-frontend/pull/62 (draft)
- Checks: lint; `imaging-study-collect` tests; build.
- Deployment: None.
- Verification: Every non-ingested file under the upload root is returned in `skipped[]` with reason (`not-dicom` | `index-file` | `unreadable`); `skippedNonDicom` equals `skipped.length`.
- Blockers: None.
- Follow-ups: Merge FE+BE; smoke PET/CT upload summary shows DICOMDIR/README/desktop.ini skips.

## 2026-07-15 - SEC-92 - Stop Untitled Series fallback in study grouping

- Status: PR created / needs merge approval.
- Human approval: Pending.
- Branch/worktree: `sec-92-untitled-series-fallback`.
- Files changed: `src/services/dicomImaging.service.ts` (seriesDescription null when tag absent).
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/59 (draft); FE https://github.com/SecondOP-Org/secondop-frontend/pull/60 (draft)
- Checks: lint; dicom tests; build.
- Deployment: None.
- Verification: API no longer injects literal "Untitled Series"; FE builds modality+count labels.
- Blockers: None.
- Follow-ups: Merge FE+BE; deploy BE so new studies omit the placeholder (FE also ignores existing "Untitled Series").

## 2026-07-14 - SEC-90 - Imaging upload feedback (errors, phases, cancel)

- Status: PR created / needs merge approval.
- Human approval: Pending.
- Branch/worktree: `sec-90-imaging-upload-feedback`.
- Files changed: `src/utils/zipExtract.ts`; `src/services/imagingStudyIngest.service.ts`; `src/controllers/file.controller.ts`; zip/collect unit tests; ledger.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/58 (draft); FE https://github.com/SecondOP-Org/secondop-frontend/pull/58 (draft)
- Checks: `npm run lint`; `npm test` (178 passed, 1 skipped); `npm run build`.
- Deployment: None.
- Verification: Corrupt zip → AppError 400; distinct no-DICOM vs corrupt messages; ingest returns `ingested`/`failed[]`; client disconnect aborts mid-ingest and rolls back persisted files.
- Blockers: None.
- Follow-ups: Human merge approval; deploy BE before/with FE so new result shape and 400 messages are live together.

## 2026-07-14 - Deploy SEC-86 doctor PDF redesign

- Status: Done.
- Human approval: User asked to deploy backend after confirming SEC-86 was merged but not live.
- Branch/worktree: `main` @ `f3244eb`.
- Files changed: none (deploy only); set `BACKEND_GIT_SHA=f3244eb…` on staging/production.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/55 (already merged).
- Checks: Staging + production `/health` 200; `/version` gitSha `f3244eb…`.
- Deployment: Railway staging `secondop-backend-staging` + production `secondop-backend` via `railway up`.
- Verification: Both report `f3244eb0eeb26e6f9f2d9fc62567708fcd5bbcd7`.
- Blockers: None. No new migrations for SEC-86.
- Follow-ups: Optional visual spot-check of preview vs final doctor opinion PDF.

## 2026-07-14 - SEC-86 - Redesign doctor opinion PDF

- Status: PR created / needs merge approval.
- Human approval: Pending (implement from `DOCTOR_PDF_REDESIGN_TODO.md` + AGENTS.md workflow).
- Branch/worktree: `sec-86-doctor-pdf-redesign`.
- Files changed: `src/services/doctorOpinionPdf.service.ts`; preview/send wiring in `case.controller.ts`; `assets/secondop-logo.png`; PDF unit tests; TODO acceptance checkboxes.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/55 (draft)
- Checks: `npm run lint`; `npm test` (173 passed, 1 skipped); `npm run build`.
- Deployment: None.
- Verification: Preview sets `isDraft`; send sets `signedAt` + no watermark; summary-first navy/cream layout.
- Blockers: None.
- Follow-ups: Human visual review of a generated PDF before merge; optional HTML→PDF later if design outgrows PDFKit.

## 2026-07-14 - SEC-11 - Paginate unbounded list endpoints

- Status: Merging.
- Human approval: User asked to merge SEC-14 and SEC-11 and proceed.
- Branch/worktree: `sec-11-paginate-list-endpoints`.
- Files changed: `src/utils/pagination.ts`; `getCases`/`getDoctorCases`/`getFiles`/`getMessages` return `page`/`pageSize`/`total`; FE `fetchAllPages` for case/message lists.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/54; FE https://github.com/SecondOP-Org/secondop-frontend/pull/51
- Checks: BE lint/test/build; FE lint/build.
- Deployment: None.
- Verification: Default pageSize 50 (max 100); `data` array shape preserved; FE aggregates pages for inbox/chat.
- Blockers: Rebased onto main after SEC-14 merge (ledger conflict).
- Follow-ups: UI page controls if product wants partial lists instead of client-side aggregation.

## 2026-07-14 - SEC-14 - Guard unsupported LangChain runtime at startup

- Status: Done (merged).
- Human approval: User asked to merge SEC-14 and SEC-11 and proceed.
- Branch/worktree: `sec-14-langchain-runtime-guard`.
- Files changed: `src/config/agenticRuntime.ts`, `src/server.ts` startup assert, adapter/orchestration shared helpers, tests, `.env.example`, `docs/LANGGRAPH_RUNTIME.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/53 (merged)
- Checks: lint/test (164 passed, 1 skipped)/build.
- Deployment: None.
- Verification: Unsupported `AGENTIC_RUNTIME` fails startup; `native`/`langchain` preserved; langchain fallback policy logged explicitly.
- Blockers: None.
- Follow-ups: None.

## 2026-07-14 - SEC-51 - Real-time case-analysis progress stream

- Status: In Review (draft PRs).
- Human approval: User asked to merge SEC-84 and proceed next; DICOM epic SEC-74 closed.
- Branch/worktree: `sec-51-analysis-progress`.
- Files changed: `analysisProgress.service.ts`, `GET /cases/:caseId/analysis/progress` NDJSON stream, FE consultation stage UI + Observability/Mission Control labels; polling retained.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/52 (draft); FE https://github.com/SecondOP-Org/secondop-frontend/pull/50
- Checks: BE lint/test (156 passed, 1 skipped)/build; FE lint/build.
- Deployment: None. Proxy buffering should honor `X-Accel-Buffering: no` for NDJSON.
- Verification: Safe stages only; polling fallback remains.
- Blockers: Waiting on merge approval.
- Follow-ups: Staging proxy stream smoke.

## 2026-07-14 - SEC-84 - DICOM header PHI de-identification on ingest

- Status: In Review (draft PR).
- Human approval: User asked to merge SEC-83 and continue.
- Branch/worktree: `sec-84-dicom-deid`.
- Files changed: `dicomDeidentification.service.ts`, `022_dicom_deid_vault.sql`, ingest/upload wiring, `dcmjs` dependency, tests, `.env.example`, setup-db/migrate through 022.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/51 (draft)
- Checks: `npm run lint`, `npm test` (151 passed, 1 skipped), `npm run build`.
- Deployment: None. Apply migration `022`; enable `DICOM_DEID_ENABLED` only with `DEID_REVERSIBLE_KEY` after compliance review.
- Verification: Header PHI stripped/replaced; study UID remap consistent; sealed vault; audit without raw PHI.
- Blockers: Waiting on merge approval.
- Follow-ups: Burned-in pixel PHI / Presidio image redactor; privileged re-id tooling.

## 2026-07-14 - SEC-83 - Key-image capture into opinion PDF

- Status: In Review (draft PRs).
- Human approval: User asked to merge SEC-82 and proceed.
- Branch/worktree: `sec-83-key-images`.
- Files changed: `doctorResponse.schema.ts` (`keyImages`), `doctorResponse.service.ts` (append/resolve labels), `doctorOpinionPdf.service.ts` (embed section), `case.controller.ts` / `case.routes.ts` (`POST .../key-images`), `upload.ts` (`keyImageUpload`); FE Send to report + draft list.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/50 (draft); FE https://github.com/SecondOP-Org/secondop-frontend/pull/49
- Checks: `npm run lint`, `npm test` (146 passed, 1 skipped), `npm run build`; FE lint/build passed.
- Deployment: None.
- Verification: Captured PNG stored under uploads; PDF Key Images section with series/slice label.
- Blockers: Waiting on merge approval.
- Follow-ups: Optional key-image file download URL for FE thumbnails.

## 2026-07-14 - SEC-81 - Case-bound team DICOM annotations + audit

- Status: In Review (draft PRs).
- Human approval: User asked to proceed to next after SEC-80 merge.
- Branch/worktree: `sec-81-team-annotations`.
- Files changed: `021_file_annotation_team_and_audit.sql`, `dicomImaging.service.ts` (shared get/save, author stamp, events), `file.controller.ts`, tests; FE author UI + team toast.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/49 (draft); FE https://github.com/SecondOP-Org/secondop-frontend/pull/47
- Checks: `npm run lint`, `npm test` (144 passed, 1 skipped), `npm run build`; FE lint/build passed.
- Deployment: None. Apply migration `021` on deploy.
- Verification: Shared per-file annotations; create/update/delete write `file_annotation_events`.
- Blockers: Waiting on merge approval.
- Follow-ups: @mentions deferred; optional audit history UI.

## 2026-07-14 - SEC-79 - Allow angle + HU stats on DICOM annotations

- Status: In Review (draft PR).
- Human approval: User asked to merge SEC-78 and continue to next (SEC-79).
- Branch/worktree: `sec-79-annotation-angle`.
- Files changed: `dicomImaging.service.ts` (`angle` type + optional `huStats` in parse/persist).
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/48 (draft); FE https://github.com/SecondOP-Org/secondop-frontend/pull/45
- Checks: `npm run lint`, `npm test` (141 passed, 1 skipped), `npm run build`.
- Deployment: None.
- Verification: Parser accepts `angle` and optional HU stats payload.
- Blockers: Waiting on merge approval.
- Follow-ups: Persistence polish in P2 annotations (SEC-81).

## 2026-07-14 - SEC-76 - Whole-study DICOM ingest (folder, zip, DICOMDIR)

- Status: In Review (draft PRs).
- Human approval: User approved merge of SEC-75 and asked to proceed to next (SEC-76).
- Branch/worktree: `sec-76-whole-study-ingest`.
- Files changed: `imagingStudyIngest.service.ts`, `dicomMagic`/`dicomdir`/`zipExtract` utils, `upload-study` route + study multer, `.env.example`, tests, `yauzl` dependency.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/47 (draft); FE https://github.com/SecondOP-Org/secondop-frontend/pull/42
- Checks: `npm run lint`, `npm test` (141 passed, 1 skipped), `npm run build`.
- Deployment: None. Set `MAX_STUDY_SIZE` / `MAX_STUDY_FILES` in staging if defaults need override.
- Verification: Magic-positive files collected; junk skipped; zip extract with zip-slip guards.
- Blockers: Waiting on merge approval.
- Follow-ups: Chunked/resumable multi-GB PET; object storage when volume pressure rises; SEC-77 wire viewer to real studies.

## 2026-07-13 - (no Linear) - Presidio production-grade durable vault

- Status: In Review (draft PR).
- Human approval: User asked to make Presidio de-identification production grade, then commit and open a draft PR.
- Branch/worktree: `presidio-phase1-deidentification`.
- Files changed: `migrations/020_case_analysis_deid_vault.sql`, `src/services/deidVault.service.ts`, `presidioHealth.service.ts`, analysis/reportExtraction/persist/worker wiring with `runId`, Presidio status route, docker healthchecks, tests, setup-db, docs.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/46 (draft)
- Checks: `npm run lint`, `npm test` (138 passed, 1 skipped), `npm run build`, `npm run eval:harness` passed. Local migration `020` applied.
- Deployment: None. Requires migration `020` + Presidio sidecars + `DEID_REVERSIBLE_KEY` before enabling in staging.
- Verification: Sealed vault upsert before LLM; load-on-reidentify fallback; clear after success; fail closed without key; health probes; live Presidio smoke with fake PHI passed earlier.
- Blockers: Railway Presidio deploy + human staging enablement; waiting on merge approval.
- Follow-ups: Vision-OCR image PHI; staging smoke with DEID_ENABLED; align workspace `AI_CONTRACT.md` if maintained outside this repo.

## 2026-07-13 - (no Linear) - Presidio full de-identification (Phases 1–3)

- Status: Ready for test.
- Human approval: User asked to skip Linear and implement the full `PRESIDIO_DEIDENTIFICATION_SPEC.md`.
- Branch/worktree: `presidio-phase1-deidentification`.
- Files changed: Presidio client/config/recognizers, deidentification + analysisDeidentification services, reportExtraction/analysis/visionOcr wiring, docker-compose deid profile, `.env.example`, AI_CONTRACT (workspace), tests, spec, ledger.
- PR: Pending.
- Checks: `npm run lint`, `npm test` (133 passed, 1 skipped), `npm run build`, `npm run eval:harness` passed.
- Deployment: None. Railway Presidio sidecars not provisioned (requires human/ops).
- Verification: Token vault de-id before LLM; reidentify clinician artifact; intake narrative de-id; MRN/insurance/accession ad-hoc recognizers; fail-closed; audit without raw PHI.
- Blockers: Live Presidio containers for end-to-end smoke; optional `DEID_REVERSIBLE_KEY` for sealed maps; Railway deploy approval.
- Follow-ups: Vision-OCR image PHI; durable DB vault column if cross-process resume needed; Railway Presidio services.

## 2026-07-12 - SEC-72 - Hybrid OCR for medical reports (PDF scans + images)

- Status: Ready for test.
- Human approval: User requested implementation per AGENTS.md workflow.
- Branch/worktree: `sec-72-hybrid-ocr-reports`.
- Files changed: `migrations/019_document_ocr.sql`, `src/services/documentExtraction.service.ts`, `src/services/textractOcr.service.ts`, `src/services/visionOcr.service.ts`, `src/services/ocrConfig.service.ts`, `src/services/reportExtraction.service.ts`, `src/services/reportExtractionBackground.service.ts`, `src/services/medicalFileAnalysis.service.ts`, `src/controllers/file.controller.ts`, `src/controllers/case.controller.ts`, `src/services/analysis.service.ts`, `.env.example`, `scripts/setup-db.sh`, `package.json`, tests, `docs/AGENT_RUN_LEDGER.md`. Frontend: consultation upload/gating and extraction status UI.
- PR: Pending.
- Checks: Backend `npm run lint`, `npm test` (125 passed), `npm run build` passed. Frontend `npm run lint`, `npm run build` passed.
- Deployment: None.
- Verification: Tiered extraction pipeline (`pdf-parse` → Textract → vision for images), image report upload in consultation flow, analysis gate accepts PDF or image reports, OCR quality metadata drives synthesis uncertainty guidance.
- Blockers: Vision fallback for scanned multi-page PDFs is Textract-only (no native PDF rasterization dependency added).
- Follow-ups: Optional S3-backed Textract async for multi-page scanned PDFs; vision fallback on PDF page images if needed.

## 2026-07-02 - SEC-47 - Implement Phase 0 AI eval harness and contract checks

- Status: Ready for test.
- Human approval: User approved creating SEC-47 and implementing Phase 0 eval harness work.
- Branch/worktree: `sec-47-eval-phase0-contract-checks`, `.worktrees/sec-46-backend`.
- Files changed: `src/evals/contractChecks.ts`, `src/evals/contractEvalHarness.ts`, `src/evals/criticEvalHarness.ts`, `scripts/run-evals.ts`, `src/agentic/critic/critic.agent.ts`, `src/__tests__/contract-checks.test.ts`, `src/__tests__/langgraph-adapter.test.ts`, `.github/workflows/ci.yml`, `package.json`, `docs/AGENT_RUN_LEDGER.md`.
- PR: Pending.
- Checks: `npm run lint` passed; `npm test -- --runInBand` passed (15 suites, 58 tests); `npm run eval:harness` passed (5 contract + 3 critic fixtures); `npm run build` passed.
- Deployment: None.
- Verification: Shared contract validators cover schema, disclaimer, forbidden claims, question count, low-confidence uncertainty signals, and evidence grounding. Critic agent now reuses shared eval helpers. CI runs `npm run eval:harness` on PRs and `main`.
- Blockers: None.
- Follow-ups: Phase 1 golden JSONL dataset and optional offline RAGAS scoring.

## 2026-07-01 - SEC-46 - Deploy LiteLLM gateway to Railway staging

- Status: Ready for test.
- Human approval: User approved staging LiteLLM rollout, Railway variable updates, and gateway verification.
- Branch/worktree: `sec-46-deploy-litellm-gateway-to-railway-staging`, `.worktrees/sec-46-backend`.
- Files changed: `litellm/Dockerfile`, `litellm/README.md`, `docs/ai-gateway-litellm.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/25.
- Checks: `npm run lint` passed; `npm run build` passed; `npm test -- --runInBand --silent src/__tests__/llm-gateway.test.ts src/__tests__/llm-gateway-services.test.ts` passed.
- Deployment: Staging only. Railway services `secondop-litellm-staging` and `secondop-backend-staging` are online in environment `staging`. LiteLLM uses separate Postgres `Postgres-uF7z`; app DB remains `Postgres-k0Us`. Production services and variables were not changed.
- Verification: Staging backend health returns HTTP 200 with git SHA `8f5b44b` (SEC-45 gateway code). LiteLLM `/models` probe returns HTTP 200 with the backend virtual key. Gateway status service reports `mode=litellm`, `configured=true`, redacted host `secondop-litellm-staging-staging.up.railway.app`, approved aliases configured, and probe `available` without exposing keys or clinical data. Protected `/api/v1/ai-gateway/status` route exists on staging (doctor-auth required).
- Blockers: Staging demo doctor login was not available for live authenticated HTTP status check; status was verified through the gateway status service using Railway-injected staging variables.
- Follow-ups: Human review/merge approval for PR #25; optional browser/Command Center check with a staging doctor account.

## 2026-07-01 - SEC-45 - Introduce LiteLLM gateway for backend LLM calls

- Status: In progress.
- Human approval: User approved implementing the LiteLLM gateway plan for backend-only, opt-in, behavior-preserving model routing.
- Branch/worktree: `sec-45-litellm-gateway`, `.worktrees/sec-45-backend`.
- Files changed: Backend AI gateway config/client/status code, analysis and planner OpenAI client wiring, command-center provider status, LiteLLM local Docker profile/config example, environment example, tests, and docs.
- PR: Pending.
- Checks: `npm run build` passed; `npm run lint` passed; `npm test -- --runInBand src/__tests__/llm-gateway.test.ts src/__tests__/llm-gateway-services.test.ts` passed with local test server permission; `npm test -- --runInBand` passed with local test server permission.
- Deployment: None; production remains direct OpenAI mode by default.
- Verification: Confirmed direct OpenAI construction is centralized in the shared gateway factory, LiteLLM mode uses a virtual key/base URL, alias validation is opt-in to LiteLLM mode, and no prompts, schemas, AI contract, LangGraph flow, or frontend behavior were changed.
- Blockers: The sandbox blocks local fake HTTP server binding without escalation, so gateway routing tests require local network permission in this environment.
- Follow-ups: Open PR, update Linear with PR link, and wait for human merge approval.

## 2026-06-28 - SEC-44 - Add DB-backed LangGraph checkpoints for agentic runs

- Status: In progress.
- Human approval: User asked to proceed with the recommended SEC-44 plan and specifically cover replacing `MemorySaver` with LangGraph JS `PostgresSaver`, stable workflow `thread_id`, and restart/resume testing.
- Branch/worktree: `sec-44-langgraph-postgres-saver`, `.worktrees/sec-44-backend`.
- Files changed: `package.json`, `migrations/010_langgraph_checkpoints.sql`, `scripts/setup-db.sh`, `.github/workflows/ci.yml`, `.env.example`, `jest.config.js`, `src/agentic/langchain/adapter.ts`, `src/agentic/langchain/checkpointer.ts`, `src/agentic/langchain/threadId.ts`, `src/services/commandCenter.service.ts`, `src/controllers/commandCenter.controller.ts`, `src/__tests__/setup.ts`, `src/__tests__/langgraph-adapter.test.ts`, `src/__tests__/langgraph-postgres-checkpointer.integration.test.ts`, `src/__tests__/command-center.routes.test.ts`, `docs/LANGGRAPH_RUNTIME.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/23.
- Checks: `npm run build` passed; `npm run lint` passed; `npm test -- --runInBand` passed locally with the Postgres integration test skipped because no local `LANGGRAPH_POSTGRES_TEST_DATABASE_URL` was configured; GitHub Actions `Backend CI / Lint, test, and build` passed with Postgres service enabled.
- Deployment: None.
- Verification: Swapped the LangGraph case-analysis adapter to the official JS `PostgresSaver`, added stable `case-analysis:<runId>` workflow thread IDs, added checkpoint migration/setup wiring, added a Command Center checkpoint read model, and added an interrupt/resume integration test that runs against Postgres in CI.
- Blockers: Docker daemon and local Postgres were unavailable on this machine, so the DB-backed integration test could not be run locally; GitHub Actions now provisions Postgres for that test.
- Follow-ups: Wait for human review/merge approval.

## 2026-06-28 - SEC-43 - Introduce LangGraph runtime for agentic case analysis

- Status: In progress.
- Human approval: User asked to use LangGraph/LangChain for the agentic workflow and learn the basics.
- Branch/worktree: `sec-43-langgraph-runtime`, `.worktrees/sec-43-backend`.
- Files changed: `package.json`, `src/agentic/langchain/adapter.ts`, `src/agentic/langchain/types.ts`, `src/__tests__/langgraph-adapter.test.ts`, `docs/LANGGRAPH_RUNTIME.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: Pending.
- Checks: `npm test -- --runInBand --silent src/__tests__/langgraph-adapter.test.ts` passed; `npm run lint` passed; `npm run build` passed; `npm test -- --runInBand --silent src/__tests__/agentic-runtime.test.ts src/__tests__/langgraph-adapter.test.ts` passed; `npm test -- --runInBand --silent` passed (12 suites, 43 tests; existing `punycode` warning and expected test logs).
- Deployment: None.
- Verification: Added a real LangGraph-backed adapter behind `AGENTIC_RUNTIME=langchain`, kept native runtime as the default/fallback path, mapped current case-analysis steps to graph nodes, added in-memory LangGraph checkpoint usage, and documented the basics in `docs/LANGGRAPH_RUNTIME.md`.
- Blockers: Local default shell reported Node 16 during dependency install; checks should use the repo-supported Node 18+ runtime.
- Follow-ups: DB-backed LangGraph checkpoints and human interrupts should be separate follow-up work after the first graph runtime lands.

## 2026-06-27 - SEC-42 - Expose multi-agent lanes in command center

- Status: In progress.
- Human approval: User asked to start on multi agents and proceed under the established workflow.
- Branch/worktree: `sec-42-expose-multi-agent-lanes`, `.worktrees/sec-42-backend`.
- Files changed: `src/services/commandCenter.service.ts`, `src/__tests__/command-center.routes.test.ts`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/21.
- Checks: `npm test -- --runInBand --silent src/__tests__/command-center.routes.test.ts` passed; `npm run lint` passed; `npm run build` passed; `npm test -- --runInBand --silent` passed.
- Deployment: None.
- Verification: Added structured command-center agent lanes for Product/spec, Coding, PR review, QA/smoke-test, Release/deploy, and Command-center/status agents; statuses are inferred from sanitized ledger-backed work items and tested through the summary controller response.
- Blockers: None.
- Follow-ups: Pair with frontend SEC-42 command-center UI changes.

## 2026-06-24 - SEC-18 - Provision staging environments for backend and frontend

- Status: In progress.
- Human approval: User asked to proceed without pausing for non-critical approvals.
- Branch/worktree: `sec-18-provision-staging-environments-for-backend-and-frontend`, `.worktrees/sec-18-backend`.
- Files changed: `src/config/cors.ts`, `src/server.ts`, `src/__tests__/cors-config.test.ts`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/13.
- Checks: `npm run lint` passed; `npm run build` passed; `npm test -- --runInBand --silent` passed.
- Deployment: Railway staging environment `staging`; service `secondop-backend-staging`; isolated staging Postgres `Postgres-k0Us`; backend URL `https://secondop-backend-staging-staging.up.railway.app`; latest SEC-18 staging deployment `e7107828-1fd7-4a61-8765-c183895cdccf` succeeded.
- Verification: Staging DB migrations `001` through `009` were applied; `GET /health` returned HTTP 200 with `{"status":"ok"}`; CORS reflected the exact Vercel preview origin `https://secondop-frontend-kins2bi6w-vinodhs-projects-0f6d26b0.vercel.app`.
- Blockers: Vercel preview URL is protected by Vercel SSO, so unauthenticated `curl` returns 302; deployment readiness was verified via Vercel CLI metadata and backend CORS smoke checks.
- Follow-ups: Keep staging Railway deploy source aligned after the CORS parser PR merges so future variable changes do not redeploy old `main` code.

## 2026-06-26 - SEC-41 - Investigate backend GitHub Actions zero-job workflow failures

- Status: In progress.
- Human approval: User asked to work on SEC-41 under the established autonomous workflow.
- Branch/worktree: `sec-41-investigate-backend-github-actions-zero-job-workflow`, `.worktrees/sec-41-backend`.
- Files changed: `.github/workflows/backend-ci.yml`, `.github/workflows/ci.yml`, `.npmrc`, temporary `.github/workflows/actions-smoke.yml` diagnostic, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/20.
- Checks: `git diff --check` passed; Ruby YAML parse passed for diagnostic and final workflow shapes; GitHub Actions run `28268569899` passed install, lint, tests, and build on `.github/workflows/ci.yml`.
- Deployment: None; workflow investigation only.
- Verification: Confirmed backend and frontend repository Actions permissions both report enabled/all with read workflow permissions, while frontend workflows schedule jobs successfully and backend workflows fail in 0s with no jobs/logs. Pushed a temporary quoted-`on` smoke workflow; it created a real `Smoke` job and passed, while the existing unquoted backend CI workflow failed again on the same push with zero jobs. A minimal same-name `Backend CI / Lint, test, and build` workflow scheduled successfully; restoring real steps converted the failure from zero-job to a normal `npm install` failure caused by checked-in absolute `.npmrc` cache/log paths. After making `.npmrc` portable, GitHub CI passed install, lint, tests, and build on run `28268493937`.
- Blockers: None currently.
- Follow-ups: Open the SEC-41 PR and verify the pull request creates the real `Backend CI / Lint, test, and build` check.

## 2026-06-26 - SEC-19 - Fix backend CI main trigger after production merge

- Status: In progress.
- Human approval: User asked to resume and push to production.
- Branch/worktree: `sec-19-fix-backend-ci-main-trigger`, `.worktrees/deploy-backend-prod-20260626`.
- Files changed: `.github/workflows/backend-ci.yml`, `docs/AGENT_RUN_LEDGER.md`.
- PR: Pending.
- Checks: Pending.
- Deployment: Backend application was already deployed to Railway production before this CI hotfix; no app redeploy required for this workflow-only change.
- Verification: Main push run for the original SEC-19 workflow failed in 0s with no jobs/logs; this hotfix narrows triggers to `main`, quotes the `on` key, and quotes Node version for cleaner parser behavior.
- Blockers: None.
- Follow-ups: Merge and verify backend CI creates a real job on `main`.

## 2026-06-26 - SEC-19 - Rename backend CI workflow file after zero-job runs

- Status: In progress.
- Human approval: User asked to resume and push to production.
- Branch/worktree: `sec-19-fix-backend-ci-workflow-file`, `.worktrees/deploy-backend-prod-20260626`.
- Files changed: `.github/workflows/backend-ci.yml`, `.github/workflows/ci.yml`, `docs/AGENT_RUN_LEDGER.md`.
- PR: Pending.
- Checks: Pending.
- Deployment: No backend app redeploy required unless Railway auto-deploys main after merge; workflow-only change.
- Verification: Backend Actions are enabled and allowed, but both original and main-trigger hotfix workflow records failed in 0s with no jobs/logs. This follow-up renames the workflow file to force a fresh workflow registration and uses a conventional trigger shape.
- Blockers: None.
- Follow-ups: Merge and verify `.github/workflows/ci.yml` creates a real job on `main`.

## 2026-06-25 - SEC-19 - Add backend GitHub CI for lint, tests, and build

- Status: In review.
- Human approval: User asked to work on the next Linear item autonomously through PR readiness.
- Branch/worktree: `sec-19-add-backend-github-ci`, `.worktrees/sec-19-backend`.
- Files changed: `.github/workflows/backend-ci.yml`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/16.
- Checks: `PATH=/opt/homebrew/bin:$PATH npm run lint` passed; `PATH=/opt/homebrew/bin:$PATH npm test -- --runInBand` passed (9 suites, 35 tests; Node emitted an existing `punycode` deprecation warning); `PATH=/opt/homebrew/bin:$PATH npm run build` passed; `ruby -e "require 'yaml'; p YAML.load_file('.github/workflows/backend-ci.yml').keys"` parsed the workflow with Ruby's YAML 1.1 `on` key display quirk; GitHub registered `.github/workflows/backend-ci.yml` as active, but new-workflow branch runs completed in 0s with no jobs because the workflow is not on default `main` yet.
- Deployment: None; CI workflow-only backend change.
- Verification: Confirmed backend exposes `npm run lint`, `npm test`, and `npm run build`; package engines allow Node `>=18.0.0`; current `origin/main` has no checked-in `package-lock.json`, so workflow uses `npm install` rather than `npm ci`; local checks used Homebrew Node `v23.6.1`; temporary validation PR #17 was opened against the SEC-19 branch and closed after confirming GitHub still produced no PR check while the workflow is absent from default `main`.
- Blockers: GitHub Actions cannot fully prove this first backend workflow on PR #16 until the workflow exists on default `main`; after merge, future backend PRs should show the `Backend CI / Lint, test, and build` check.
- Follow-ups: After human approval/merge, confirm the first post-merge backend branch or PR gets a real GitHub Actions job on Node 20; consider a separate ticket to commit a backend package lock and switch CI/local docs to `npm ci`.

## 2026-06-25 - SEC-22 - Expose backend version and build metadata

- Status: In progress.
- Human approval: User asked to work on the next item and proceed without pausing for non-critical approvals.
- Branch/worktree: `sec-22-expose-backend-version-and-build-metadata`, `.worktrees/sec-22-backend`.
- Files changed: `.env.example`, `README.md`, `docs/AGENT_RUN_LEDGER.md`, `src/config/releaseMetadata.ts`, `src/controllers/version.controller.ts`, `src/server.ts`, `src/__tests__/release-metadata.test.ts`.
- PR: Pending.
- Checks: `npm test -- --runInBand --silent src/__tests__/release-metadata.test.ts` passed; `npm run lint` passed; `npm run build` passed; `npm test -- --runInBand --silent` passed.
- Deployment: None; backend endpoint implementation only.
- Verification: Added safe release metadata builder, `/version` endpoint, `/health.version` metadata, env guidance, and tests for shape and unsafe value fallback.
- Blockers: None.
- Follow-ups: Configure hosted Railway metadata values during deployment after merge.

## 2026-06-25 - SEC-21 - Define release versioning and build metadata policy

- Status: In progress.
- Human approval: User asked to work on the next item and proceed without pausing for non-critical approvals.
- Branch/worktree: `sec-21-define-release-versioning-and-build-metadata-policy`, `.worktrees/sec-21-backend`.
- Files changed: `docs/RELEASE_VERSIONING.md`, `README.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: Pending.
- Checks: `git diff --check` passed; conflict-marker scan passed; release/version terminology scan completed.
- Deployment: None; documentation/policy-only backend change.
- Verification: Defined one product release version, separate backend/frontend build metadata, separate API versioning, package-version treatment, environment sources, deployment record fields, and follow-up mapping to SEC-22/SEC-23.
- Blockers: None.
- Follow-ups: Pair with frontend SEC-21 PR; implement backend metadata exposure under SEC-22.

## 2026-06-24 - SEC-36 - Add PR review agent checklist and review output template

- Status: In progress.
- Human approval: User asked to work on the next three Linear items after SEC-38.
- Branch/worktree: `sec-36-add-pr-review-agent-checklist-and-review-output-template`, `.worktrees/sec-36-backend`.
- Files changed: `docs/PR_REVIEW_AGENT.md`, `AGENTS.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/12.
- Checks: `rg` conflict-marker scan passed; secret-pattern scan passed; `git diff --check` passed; dry-run metadata inspection completed for docs-only PR #11 and code PR #9.
- Deployment: None; documentation/workflow-only backend change.
- Verification: Added the PR review agent checklist, severity scale, findings-first output template, GitHub/Linear reflection rules, and AGENTS.md pointer; confirmed the template can be applied to recent docs-only and code PR metadata.
- Blockers: None.
- Follow-ups: Pair with frontend PR and wait for human review/approval before merge.

## 2026-06-24 - SEC-39 - Functional backend command-center API with admin authorization

- Status: In progress.
- Human approval: User asked to work on the next three Linear items after SEC-38.
- Branch/worktree: `sec-39-design-backend-command-center-api-with-admin-authorization`, `.worktrees/sec-39-backend`.
- Files changed: `.env.example`, `docs/COMMAND_CENTER_API_DESIGN.md`, `docs/AGENT_RUN_LEDGER.md`, `src/controllers/commandCenter.controller.ts`, `src/middleware/commandCenterAuth.ts`, `src/routes/commandCenter.routes.ts`, `src/services/commandCenter.service.ts`, `src/server.ts`, `src/__tests__/command-center.routes.test.ts`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/11.
- Checks: `npm test -- --runInBand --silent src/__tests__/command-center.routes.test.ts` passed; `npm run lint` passed; `npm run build` passed; `npm test -- --runInBand --silent` passed; `git diff --check` passed; conflict-marker scan passed; secret-pattern scan passed.
- Deployment: None; backend API implementation only.
- Verification: Added authenticated command-center routes, operator allowlist authorization, sanitized ledger-backed service responses, provider status placeholders, env guidance, and tests for auth required, non-operator denial, operator success, latest ledger output, and redaction.
- Blockers: None.
- Follow-ups: Wait for human review/approval before merge.

## 2026-06-24 - SEC-38 - Build local command-center report generator

- Status: In progress.
- Human approval: User approved starting SEC-38 after SEC-20 production deployment.
- Branch/worktree: `sec-38-build-local-command-center-report-generator`, `.worktrees/sec-38-backend`.
- Files changed: `scripts/command-center-report.mjs`, `docs/COMMAND_CENTER_REPORT.md`, `package.json`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/10.
- Checks: `node --check scripts/command-center-report.mjs` passed; `npm run command-center:report` passed; `npm run command-center:report -- --linear-snapshot temp/command-center/linear-sec-queue.json` passed; `npm run command-center:report -- --linear-snapshot temp/command-center/linear-sec-queue.json --live-deploys` passed with provider data unavailable as a reported blocker; `npm run lint` passed; `npm run build` passed; `npm test -- --runInBand --silent` passed.
- Deployment: None; local workflow tooling only.
- Verification: Generated ignored Markdown and JSON reports under `temp/command-center/`, verified missing Linear/provider data is reported as blockers instead of crashes, and scanned generated output for common secret/token patterns.
- Blockers: None.
- Follow-ups: Wait for human review/approval before merge.

## 2026-06-24 - SEC-20 - Add checked-in backend ESLint configuration

- Status: In progress.
- Human approval: User approved SEC-35 merge flow and asked to start SEC-20.
- Branch/worktree: `sec-20-add-checked-in-backend-eslint-configuration`, `.worktrees/sec-20-backend`.
- Files changed: `.eslintrc.cjs`, `src/controllers/auth.controller.ts`, `src/services/reportExtraction.service.ts`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/9.
- Checks: `npm run lint` passed; `npm run build` passed; `npm test -- --runInBand --silent` passed.
- Deployment: None.
- Verification: Added backend ESLint config, fixed the initial narrow lint findings, and verified checks from the isolated worktree using the existing backend dependency tree.
- Blockers: None.
- Follow-ups: Wait for human review/approval before merge.

## 2026-06-24 - SEC-35 - Design command-center view for Linear, PR, checks, deploys, and run ledger

- Status: In progress.
- Human approval: User asked to start SEC-35 after SEC-34 was approved and merged.
- Branch/worktree: `sec-35-design-command-center-view`, `.worktrees/sec-35-backend`.
- Files changed: `AGENTS.md`, `docs/COMMAND_CENTER_DESIGN.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/8.
- Checks: `rg` conflict-marker scan passed; `git diff --check` passed.
- Deployment: None; documentation/design-only backend change.
- Verification: Confirmed command-center design should start as a local generated report, not a hidden static frontend route.
- Blockers: None.
- Follow-ups: SEC-38 for local report generator; SEC-39 for backend command-center API; SEC-40 for protected frontend admin UI.

## 2026-06-24 - SEC-34 - Define multi-agent engineering workflow and handoff contract

- Status: In progress.
- Human approval: User asked to start SEC-34 after SEC-27 was approved and merged.
- Branch/worktree: `sec-34-define-multi-agent-engineering-workflow-and-handoff-contract`, `.worktrees/sec-34-backend`.
- Files changed: `AGENTS.md`, `docs/MULTI_AGENT_WORKFLOW.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/7.
- Checks: `rg` conflict-marker scan passed; `git diff --check` passed.
- Deployment: None; documentation/workflow-only backend change.
- Verification: Confirmed root workspace is not a git repo, so durable workflow updates are being made in repo-specific docs.
- Blockers: None.
- Follow-ups: Pair with frontend SEC-34 PR and use SEC-35 for command-center design.

## 2026-06-23 - SEC-27 - Update agent workflow approval gate and Linear status mapping

- Status: In progress.
- Human approval: User requested moving the human approval gate to PR merge/deploy approval after Linear spec is recorded.
- Branch/worktree: `vinodhpeddi/sec-27-update-agent-workflow-approval-gate-and-linear-status`, `.worktrees/sec-27-backend`.
- Files changed: `AGENTS.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/5.
- Checks: Pending rerun after conflict resolution.
- Deployment: None; documentation/workflow-only backend change.
- Verification: Merged current `origin/main` into the SEC-27 branch to preserve the backend run ledger from SEC-33.
- Blockers: Branch was stale and conflicted with the newer ledger guidance; resolved by keeping both the new approval workflow and ledger requirement.
- Follow-ups: Keep Linear issue in `In Review` after checks/PR refresh; wait for human merge approval.

## 2026-06-23 - SEC-33 - Add backend agent run ledger

- Status: In progress.
- Human approval: User requested backend parity with the frontend run ledger.
- Branch/worktree: `sec-33-add-backend-agent-run-ledger`, `.worktrees/sec-33-backend`.
- Files changed: `AGENTS.md`, `docs/AGENT_RUN_LEDGER.md`.
- PR: Pending.
- Checks: Pending.
- Deployment: None.
- Verification: Confirmed the backend main checkout is dirty, so work was isolated in a clean worktree from `origin/main`.
- Blockers: None.
- Follow-ups: Keep backend ledger updated for every backend agent run.

## 2026-06-23 - SEC-13 - Add backend request correlation IDs across logs and responses

- Status: Done.
- Human approval: User approved work and merge/deploy flow.
- Branch/worktree: `sec-13-add-backend-request-correlation-ids-across-logs-and`, `.worktrees/sec-13-backend`.
- Files changed: Backend request middleware/logging/response areas for request correlation ID propagation.
- PR: Merged before this ledger was introduced.
- Checks: Backend tests/build were run during the original task; see SEC-13 Linear comments and PR history for exact command output.
- Deployment: Included in backend production deployment ending at commit `af9f9d4`.
- Verification: Backend production `/health` returned 200 with `x-request-id` after deployment.
- Blockers: None recorded.
- Follow-ups: Use request IDs in support/debugging and future smoke checks.

## 2026-06-23 - SEC-10 - Require verifiable database SSL configuration for production

- Status: Done.
- Human approval: User approved work and merge/deploy flow.
- Branch/worktree: `sec-10-require-verifiable-database-ssl-configuration-for-production`, `.worktrees/sec-10-backend`.
- Files changed: Backend database SSL configuration path.
- PR: Merged before this ledger was introduced.
- Checks: Backend tests/build were run during the original task; see SEC-10 Linear comments and PR history for exact command output.
- Deployment: Included in backend production deployment ending at commit `af9f9d4`.
- Verification: Production backend health check passed after deployment.
- Blockers: None recorded.
- Follow-ups: Keep production database CA/SSL environment guidance sanitized and documented.

## 2026-06-23 - SEC-9 - Harden auth rate limiting and password reset token invalidation

- Status: Done.
- Human approval: User approved work and merge/deploy flow.
- Branch/worktree: `sec-9-harden-auth-rate-limiting-and-password-reset-token`, `.worktrees/sec-9-backend`.
- Files changed: Backend auth hardening areas for rate limiting and password reset token invalidation.
- PR: Merged before this ledger was introduced.
- Checks: Backend tests/build were run during the original task; see SEC-9 Linear comments and PR history for exact command output.
- Deployment: Included in backend production deployment ending at commit `af9f9d4`.
- Verification: Production backend health check passed after deployment.
- Blockers: None recorded.
- Follow-ups: Continue auth/security review items from the Security & Reliability queue.

## 2026-06-17 - SEC-5 - Codify agent workflow in AGENTS.md

- Status: Done.
- Human approval: User approved adding repo agent guides.
- Branch/worktree: `sec-5-backend`.
- Files changed: Backend `AGENTS.md`.
- PR: Merged before this ledger was introduced.
- Checks: Documentation-only workflow change; see SEC-5 Linear comments and PR history for exact verification.
- Deployment: Not applicable.
- Verification: Backend `AGENTS.md` became available in the repository.
- Blockers: None recorded.
- Follow-ups: SEC-27 and SEC-33 further refined agent workflow and ledger requirements.
