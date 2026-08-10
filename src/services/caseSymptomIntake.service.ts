import type { PoolClient } from 'pg';
import {
  findLatestCaseSymptomIntake,
  upsertCaseSymptomIntake as upsertCaseSymptomIntakeRow,
} from '../repositories/case.repository';

/** Loose structured symptom intake payload from the FE (SEC-208). */
export type SymptomIntakePayload = {
  chiefConcern?: string;
  symptoms?: unknown[];
  redFlags?: Record<string, unknown>;
  triageLevel?: string | null;
  acknowledgedEmergencyWarning?: boolean;
};

export function parseOptionalSymptomIntake(input: unknown): SymptomIntakePayload | null {
  if (input == null) {
    return null;
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return input as SymptomIntakePayload;
}

export async function upsertCaseSymptomIntake(
  caseId: string,
  payload: SymptomIntakePayload,
  client?: PoolClient
): Promise<void> {
  const triageLevel =
    typeof payload.triageLevel === 'string' && payload.triageLevel.trim()
      ? payload.triageLevel.trim()
      : null;

  await upsertCaseSymptomIntakeRow(caseId, JSON.stringify(payload), triageLevel, client);
}

export async function getLatestCaseSymptomIntake(
  caseId: string
): Promise<{ payload: SymptomIntakePayload; triageLevel: string | null } | null> {
  const rows = await findLatestCaseSymptomIntake(caseId);

  if (rows.length === 0) {
    return null;
  }

  return {
    payload: rows[0].payload as SymptomIntakePayload,
    triageLevel: (rows[0].triage_level as string | null) ?? null,
  };
}

/** Compact structured block for analysis prompts (non-diagnostic). */
export function formatSymptomIntakeForPrompt(
  payload: SymptomIntakePayload | null | undefined
): string {
  if (!payload) {
    return '';
  }

  const lines: string[] = ['Structured symptom intake (patient-reported; not a diagnosis):'];
  if (typeof payload.chiefConcern === 'string' && payload.chiefConcern.trim()) {
    lines.push(`- Chief concern: ${payload.chiefConcern.trim()}`);
  }
  if (typeof payload.triageLevel === 'string' && payload.triageLevel.trim()) {
    lines.push(`- Care-timing guidance label: ${payload.triageLevel.trim()}`);
  }

  if (Array.isArray(payload.symptoms)) {
    for (const raw of payload.symptoms) {
      if (!raw || typeof raw !== 'object') continue;
      const s = raw as Record<string, unknown>;
      const name = typeof s.name === 'string' ? s.name : 'Symptom';
      const area = typeof s.bodyArea === 'string' ? s.bodyArea : '';
      const severity = typeof s.severity === 'number' ? s.severity : '';
      const duration = typeof s.duration === 'string' ? s.duration : '';
      const onset = typeof s.onset === 'string' ? s.onset : '';
      const pattern = typeof s.pattern === 'string' ? s.pattern : '';
      lines.push(
        `- ${name}${area ? ` (${area})` : ''}: severity ${severity}/10, onset ${onset || 'n/a'}, duration ${duration || 'n/a'}, pattern ${pattern || 'n/a'}`
      );
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}
