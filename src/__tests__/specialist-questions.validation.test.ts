import {
  MAX_SPECIALIST_QUESTIONS,
  PATIENT_VOICE_QUESTION_MIN_LENGTH,
  parseAndValidateSpecialistQuestionsUpdate,
  parseFlexibleQuestionnaireItems,
  validatePatientVoiceQuestions,
} from '../services/specialistQuestions.validation';
import { AppError } from '../middleware/errorHandler';

describe('specialistQuestions.validation', () => {
  const longEnough = 'What should I ask about my chest pain next?';

  it('requires exactly 3 unique patient-voice questions of min length', () => {
    expect(validatePatientVoiceQuestions(['short', 'also short']).violations).toEqual(
      expect.arrayContaining([
        `Expected exactly ${MAX_SPECIALIST_QUESTIONS} patient-voice questions.`,
        `Each patient-voice question must be at least ${PATIENT_VOICE_QUESTION_MIN_LENGTH} characters.`,
      ])
    );

    expect(
      validatePatientVoiceQuestions([longEnough, longEnough + ' a', longEnough + ' b']).ok
    ).toBe(true);
  });

  it('parses string or object payloads and defaults source', () => {
    expect(parseFlexibleQuestionnaireItems(['My first patient question here'], { source: 'patient' })).toEqual([
      { id: 'sq-1', question: 'My first patient question here', source: 'patient' },
    ]);

    expect(
      parseFlexibleQuestionnaireItems(
        [{ id: 'q1', question: 'Should I worry about my ECG findings today?', source: 'ai', confirmed: true }],
        { source: 'patient' }
      )
    ).toEqual([
      {
        id: 'q1',
        question: 'Should I worry about my ECG findings today?',
        source: 'ai',
        confirmed: true,
      },
    ]);
  });

  it('marks edited AI questions without flipping source to patient', () => {
    const updated = parseAndValidateSpecialistQuestionsUpdate(
      [
        {
          id: 'q1',
          question: 'Should I ask about a stress test after my ECG?',
          source: 'ai',
          confirmed: true,
        },
      ],
      [{ id: 'q1', question: 'Should I worry about my ECG findings today?', source: 'ai' }]
    );

    expect(updated).toEqual([
      {
        id: 'q1',
        question: 'Should I ask about a stress test after my ECG?',
        source: 'ai',
        edited: true,
        confirmed: true,
      },
    ]);
  });

  it('rejects more than 3 questions', () => {
    expect(() =>
      parseAndValidateSpecialistQuestionsUpdate([
        { question: longEnough + ' 1', source: 'patient', confirmed: true },
        { question: longEnough + ' 2', source: 'patient', confirmed: true },
        { question: longEnough + ' 3', source: 'patient', confirmed: true },
        { question: longEnough + ' 4', source: 'patient', confirmed: true },
      ])
    ).toThrow(AppError);
  });
});
