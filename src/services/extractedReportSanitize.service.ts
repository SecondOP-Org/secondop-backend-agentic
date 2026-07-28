/**
 * Sanitize extracted report text and score evidence snippets for clinical prose.
 * Cleanup must live on the extracted text path so evidence_refs stay grounded
 * (exact substring match in contractChecks.computeEvidenceGroundedness).
 */

const UI_NAV_CHROME_RE =
  /\b(your health|biomarkers?|out of range|in range|filter\s*\(|improving\b|sign[\s-]?in|log[\s-]?in|click here|dashboard|navigation|menu item|privacy policy|terms of (use|service)|cookie (policy|settings)|download app)\b/i;

const SNAKE_OR_UI_TOKEN_RE = /\b[A-Za-z]{2,}_[A-Za-z0-9]{1,}\b/;

const ALL_CAPS_TOKEN_RE = /\b[A-Z]{4,}\b/g;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const letterStats = (value: string): { letters: number; lowercase: number; digits: number } => {
  let letters = 0;
  let lowercase = 0;
  let digits = 0;
  for (const ch of value) {
    if (ch >= '0' && ch <= '9') {
      digits += 1;
    } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      letters += 1;
      if (ch >= 'a' && ch <= 'z') {
        lowercase += 1;
      }
    }
  }
  return { letters, lowercase, digits };
};

const wordTokens = (value: string): string[] =>
  value.split(/[^A-Za-z0-9]+/).filter((token) => token.length > 0);

/** True when a candidate looks like portal/OCR chrome rather than clinical prose. */
export const isNavOrOcrJunkSnippet = (value: string): boolean => {
  const trimmed = normalizeWhitespace(value);
  if (trimmed.length < 8) {
    return false;
  }

  if (UI_NAV_CHROME_RE.test(trimmed)) {
    return true;
  }

  if (SNAKE_OR_UI_TOKEN_RE.test(trimmed)) {
    return true;
  }

  const { letters, lowercase, digits } = letterStats(trimmed);
  if (letters === 0) {
    return digits > 0;
  }

  const digitRatio = digits / trimmed.length;
  const lowercaseRatio = lowercase / letters;
  const tokens = wordTokens(trimmed);
  const lowercaseWords = tokens.filter((token) => /[a-z]/.test(token));
  const allCaps = trimmed.match(ALL_CAPS_TOKEN_RE) || [];

  // Digit-heavy chrome with few lowercase words (e.g. "24 Out of Range 24 … 85 In Range 0")
  if (digitRatio > 0.22 && lowercaseWords.length < 4) {
    return true;
  }

  // Title-case / ALL-CAPS label soup
  if (lowercaseRatio < 0.28 && tokens.length >= 4) {
    return true;
  }

  if (allCaps.length >= 3 && lowercaseWords.length < 3) {
    return true;
  }

  return false;
};

/**
 * Prefer snippets that look like clinical prose or short lab values.
 * Reject UI/nav chrome and OCR junk.
 */
export const isProseLikeEvidenceSnippet = (value: string): boolean => {
  const trimmed = normalizeWhitespace(value);
  if (trimmed.length < 12) {
    return false;
  }

  if (isNavOrOcrJunkSnippet(trimmed)) {
    return false;
  }

  const { letters, lowercase, digits } = letterStats(trimmed);
  if (letters === 0) {
    return false;
  }

  const tokens = wordTokens(trimmed);
  const lowercaseWords = tokens.filter((token) => /[a-z]/.test(token));
  const digitRatio = digits / trimmed.length;
  const lowercaseRatio = lowercase / letters;

  // Short lab-style lines: "Hemoglobin A1c 8.2%" / "hs-CRP 3.2 mg/L"
  if (trimmed.length < 56) {
    const hasLetterAndDigit = /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed);
    if (hasLetterAndDigit && lowercaseWords.length >= 1 && digitRatio <= 0.45) {
      return true;
    }
  }

  if (lowercaseWords.length < 3) {
    return false;
  }

  if (lowercaseRatio < 0.3) {
    return false;
  }

  // Sentence-like: at least one run of two adjacent lowercase-bearing words
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (/[a-z]/.test(tokens[i]) && /[a-z]/.test(tokens[i + 1])) {
      return true;
    }
  }

  return false;
};

/**
 * Strip repeated page headers/footers and obvious UI/nav chrome lines from
 * extracted report text. Applied before analysis / evidence selection so
 * snippets remain exact substrings of the cleaned text.
 *
 * Preserves original line content (no in-line whitespace rewriting) so
 * groundedness substring checks stay stable.
 */
export const sanitizeExtractedReportText = (text: string): string => {
  if (!text) {
    return '';
  }

  const rawLines = text.split(/\r?\n/);

  const counts = new Map<string, number>();
  for (const line of rawLines) {
    const key = normalizeWhitespace(line);
    if (key.length >= 8 && key.length <= 120) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const repeatedHeaders = new Set(
    [...counts.entries()].filter(([, count]) => count >= 3).map(([line]) => line)
  );

  const kept: string[] = [];
  for (const line of rawLines) {
    const key = normalizeWhitespace(line);
    if (!key) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') {
        kept.push('');
      }
      continue;
    }

    if (repeatedHeaders.has(key)) {
      continue;
    }

    // Drop standalone chrome lines; keep longer mixed paragraphs for grounding.
    if (key.length <= 160 && isNavOrOcrJunkSnippet(key)) {
      continue;
    }

    kept.push(line);
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
