# Doctor Opinion PDF — Redesign (for Cursor)

Tested by generating a real PDF from `src/services/doctorOpinionPdf.service.ts` (PDFKit) and
rendering it. It works but looks generic and off-brand. This plan makes it a premium, branded,
trustworthy clinical report.

Generator: `src/services/doctorOpinionPdf.service.ts` (PDFKit, `bufferPages:true`).
Input shape: `DoctorOpinionPdfInput` (caseTitle, caseNumber, patientName, doctorName,
doctorSpecialty, doctorLicenseNumber, submittedDate, questionAnswers[], summary, keyImages[],
aiAssistedReview).

## Problems found
1. Off-brand: teal `#0F766E` vs the app's deep-navy + warm-cream rebrand; no logo/letterhead.
2. Clinical Summary is rendered LAST (after Q&A) — should lead with the impression.
3. Thin patient block (Name/Case/Specialty only); no age/sex, report ID prominence, 2-col grid.
4. Flat Q&A — plain stacked text, no card/indent/Q-vs-A visual distinction.
5. Attestation is a paragraph, not a formatted e-signature block reflecting the sign-off feature.
6. Manual `wrapText(text, 90)` instead of PDFKit width-based wrapping → ragged lines.
7. Footer lacks confidentiality banner, Report ID, generated-at, contact; no PDF metadata; no
   DRAFT vs FINAL state.

════════════════════════════════════════════════════════════════════
DESIGN — brand + structure
════════════════════════════════════════════════════════════════════

### Brand tokens (match the app)
- Primary navy: use the app's `--primary` (deep navy, ~`#22447A` / `hsl(220 52% 28%)`), NOT teal.
- Accent/background tints: warm cream (`#FAF9F6`) for callout boxes; muted `#6B7280` for meta.
- Embed the SecondOp logo mark (ship a PNG under `assets/` and `doc.image()` it in the header).
- Register a clean font pair (e.g. embed Inter or keep Helvetica for body + a heavier weight for
  headings). PDFKit supports custom TTF via `doc.registerFont`.

### New report order (bottom-line-up-front)
1. **Letterhead band** — logo + "SecondOp" wordmark (navy), right-aligned report meta
   (Report ID, Report date, Case ref). Thin navy rule under it.
2. **Report title** — "Independent Second Opinion" (left-aligned, strong).
3. **Info grid (2 columns)** —
   - Left: Patient (name, age/sex if available), Case reference, Case title.
   - Right: Reviewing specialist (name, specialty), License/registration, Submitted / Report dates.
4. **Clinical Impression / Summary FIRST** — a highlighted callout box (cream bg + left navy
   accent bar) with the summary. This is the "bottom line."
5. **Patient Questions & Specialist Responses** — each as a clean block: a subtle "Q" chip +
   question (medium), then indented "Specialist response" with a left accent rule. Space between.
6. **Key Images** (if provided) — image with a bordered frame + caption; 1–2 per row.
7. **Specialist Attestation & Signature** — formatted e-signature block, visually set apart:
   > Electronically signed by
   > **Dr. John Smith, MD** — Cardiology
   > License MD123456
   > Signed: 14 Jul 2026, 3:42 PM (UTC)
   Plus the attestation sentence. Optionally a thin signature line.
8. **Footer (every page)** — left: "CONFIDENTIAL — Contains Protected Health Information"; center:
   disclaimer (existing text) + AI-assisted note when applicable; right: "Page x of y". Add a small
   line: "Report ID: <uuid> · Generated <timestamp> · secondop.in".

════════════════════════════════════════════════════════════════════
TYPOGRAPHY & LAYOUT FIXES
════════════════════════════════════════════════════════════════════
- REMOVE `wrapText()`; use PDFKit native wrapping: `doc.text(str, { width, align, lineGap })`.
- Type scale: report title ~20pt bold; section headers ~13pt bold navy; body ~10.5–11pt with
  `lineGap: 3`. Consistent vertical rhythm via a small `space()` helper instead of ad-hoc moveDown.
- Section header: navy text + a short accent block or full-width hairline (2px navy at 15% for a
  softer look than the current solid rule).
- Two-column info grid: compute column x positions from page width/margins; align labels (muted,
  9pt caps) above values (body).
- Q&A: indent answers ~16px with a 2px left accent rule; number questions; keep them together with
  `ensureSpace` so a question never orphans from its answer.

════════════════════════════════════════════════════════════════════
TRUST / AUTHENTICITY
════════════════════════════════════════════════════════════════════
- Set PDF document metadata: `new PDFDocument({ info: { Title: 'SecondOp Independent Second Opinion
  — <caseNumber>', Author: 'SecondOp', Subject: 'Second opinion report', Keywords: 'second opinion' }})`.
- Add a **Report ID** (reuse the file uuid) + **generated-at** timestamp in the footer.
- **DRAFT vs FINAL**: when generating the Preview (not yet sent), stamp a light diagonal "DRAFT"
  watermark; the signed/sent PDF has no watermark. Add an `isDraft?: boolean` to the input.
- Confidentiality banner in footer (above).
- (Future) verification: embed a short report hash or QR linking to a verify page.

════════════════════════════════════════════════════════════════════
IMPLEMENTATION APPROACH — decision
════════════════════════════════════════════════════════════════════
Two options:
- **A) Enhance the existing PDFKit generator (RECOMMENDED now).** No new deps, streaming, fast on
  Railway. Do the redesign above by adding helpers (letterhead, infoGrid, calloutBox, qaBlock,
  signatureBlock, footer). ~80% of the polish, low risk.
- **B) Switch to HTML→PDF (Puppeteer/Playwright).** Design in HTML/CSS with the app's brand tokens
  → easiest path to pixel-perfect/marketing-grade, but pulls in headless Chromium (~300MB), slower
  cold starts, more infra on Railway. Consider only if you want fully designed, frequently-restyled
  reports.
Recommendation: do **A** now; revisit **B** only if design needs outgrow PDFKit.

## Acceptance
- [x] PDF uses the app's navy/cream brand + embedded logo letterhead (no teal).
- [x] Summary/impression appears FIRST in a callout box; Q&A and signature follow.
- [x] 2-column patient/specialist info grid; native text wrapping (no ragged manual wrap).
- [x] Formatted e-signature block reflecting the attestation (name, credentials, license, signed timestamp).
- [x] Every page footer: confidentiality banner + disclaimer + page x/y + Report ID + generated-at.
- [x] PDF document metadata set; DRAFT watermark on preview, none on final.
- [x] Key images render framed with captions when present.
- [x] Existing tests updated; a visual sample regenerated and reviewed.

Implemented in Linear [SEC-86](https://linear.app/secondop/issue/SEC-86/redesign-doctor-opinion-pdf-branded-clinical-report).

## Note
Per repo workflow, open a Linear issue before implementing. A sample of the CURRENT output was
generated during review for comparison.
