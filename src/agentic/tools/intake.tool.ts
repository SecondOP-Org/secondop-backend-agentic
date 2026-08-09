import { query } from '../../database/connection';
import { AgenticError, AgenticLoopState, AgenticRuntimeContext } from '../core/types';

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

const assertText = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgenticError('validation_error', `${fieldName} is required.`);
  }

  return value.trim();
};

export const validateIntakeTool = async (
  context: AgenticRuntimeContext,
  state: AgenticLoopState
): Promise<AgenticLoopState> => {
  if (context.fixtures?.intake) {
    return {
      ...state,
      intake: context.fixtures.intake,
    };
  }

  const result = await query(
    `SELECT age_at_submission, sex, specialty_context, symptoms,
            symptom_duration, medical_history, current_medications, allergies
     FROM case_intake
     WHERE case_id = $1`,
    [context.caseId]
  );

  if (result.rows.length === 0) {
    throw new AgenticError('validation_error', 'Case intake not found for agentic execution.');
  }

  const row = result.rows[0] as IntakeRow;
  const age = Number(row.age_at_submission);

  if (!Number.isFinite(age) || age < 0 || age > 130) {
    throw new AgenticError('validation_error', 'intake.age must be between 0 and 130');
  }

  return {
    ...state,
    intake: {
      age,
      sex: assertText(row.sex, 'sex'),
      specialtyContext: assertText(row.specialty_context, 'specialtyContext'),
      symptoms: assertText(row.symptoms, 'symptoms'),
      symptomDuration: assertText(row.symptom_duration, 'symptomDuration'),
      medicalHistory: assertText(row.medical_history, 'medicalHistory'),
      currentMedications: assertText(row.current_medications, 'currentMedications'),
      allergies: assertText(row.allergies, 'allergies'),
    },
  };
};
