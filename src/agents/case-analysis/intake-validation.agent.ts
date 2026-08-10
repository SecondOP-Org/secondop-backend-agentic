import { query } from '../../database/connection';
import { getLatestCaseSymptomIntake } from '../../services/caseSymptomIntake.service';
import { AgentContext, AgentError, AgentStep } from '../core/agent.types';
import { CaseAnalysisPipelineState } from './case-analysis.types';

interface IntakeRow {
  age_at_submission: number;
  sex: string;
  specialty_context: string;
  symptoms: string;
  symptom_duration: string;
  medical_history: string;
  current_medications: string;
  allergies: string;
}

const requireString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentError('validation_error', `${fieldName} is required for analysis.`);
  }

  return value.trim();
};

/** Free-text symptoms are optional; blank becomes empty string. */
const optionalString = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

export class IntakeValidationAgent implements AgentStep<CaseAnalysisPipelineState, CaseAnalysisPipelineState> {
  public readonly name = 'intake-validation';

  public async run(
    input: CaseAnalysisPipelineState,
    context: AgentContext
  ): Promise<CaseAnalysisPipelineState> {
    if (context.fixtures?.intake) {
      return {
        ...input,
        intake: context.fixtures.intake,
      };
    }

    const result = await query(
      `SELECT age_at_submission, sex, specialty_context, symptoms,
              symptom_duration, medical_history, current_medications, allergies
       FROM case_intake
       WHERE case_id = $1`,
      [input.caseId]
    );

    if (result.rows.length === 0) {
      throw new AgentError('validation_error', 'Case intake not found for analysis.');
    }

    const row = result.rows[0] as IntakeRow;
    const age = Number(row.age_at_submission);

    if (!Number.isFinite(age) || age < 0 || age > 130) {
      throw new AgentError('validation_error', 'Case intake age must be between 0 and 130.');
    }

    const structured = await getLatestCaseSymptomIntake(input.caseId);

    const intake = {
      age,
      sex: requireString(row.sex, 'intake.sex'),
      specialtyContext: requireString(row.specialty_context, 'intake.specialtyContext'),
      symptoms: optionalString(row.symptoms),
      symptomDuration: optionalString(row.symptom_duration),
      medicalHistory: requireString(row.medical_history, 'intake.medicalHistory'),
      currentMedications: requireString(row.current_medications, 'intake.currentMedications'),
      allergies: requireString(row.allergies, 'intake.allergies'),
      structuredSymptomIntake: structured?.payload,
    };

    return {
      ...input,
      intake,
    };
  }
}
