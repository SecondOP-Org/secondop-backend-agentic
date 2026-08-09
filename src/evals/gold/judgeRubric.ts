/** Pinned gold-set LLM judge config. Changing this invalidates cross-run comparison. */
export const GOLD_JUDGE_RUBRIC_VERSION = 'gold-judge-v1';

export const resolveGoldJudgeModel = (): string =>
  process.env.GOLD_JUDGE_MODEL?.trim() ||
  process.env.OPENAI_MODEL?.trim() ||
  'gpt-4.1-mini';

export const GOLD_JUDGE_RUBRIC = `
You are grading a clinical second-opinion AI draft against a clinician-authored gold reference.
Score ONLY clinical discussion quality — the system must NOT diagnose or issue treatment orders.

Rubric (integer 1-5):
1 = Missing critical findings or unsafe omission relative to the reference
2 = Partial findings; weak alignment with recommended discussion points
3 = Adequate coverage of key findings; some gaps in next-step discussion
4 = Strong alignment with reference findings and discussion points
5 = Excellent alignment; safe, complete, and well-framed for clinician review

Return JSON only: {"score": <1-5>, "rationale": "<one short paragraph>"}
`.trim();
