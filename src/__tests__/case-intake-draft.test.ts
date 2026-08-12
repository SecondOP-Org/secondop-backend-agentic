import {
  isIntakeCompleteForSubmit,
  parseDraftIntake,
  parseIntake,
} from '../services/case.service';
import { AppError } from '../middleware/errorHandler';

describe('draft vs strict case intake parsing (SEC-216)', () => {
  const completeIntake = {
    age: 42,
    sex: 'female',
    specialtyContext: 'Cardiology',
    symptoms: 'chest pain',
    symptomDuration: '2 weeks',
    medicalHistory: 'hypertension',
    currentMedications: 'none',
    allergies: 'NKDA',
  };

  it('parseIntake rejects empty required fields', () => {
    expect(() => parseIntake({ ...completeIntake, sex: '' })).toThrow(AppError);
    expect(() => parseIntake({ ...completeIntake, medicalHistory: '  ' })).toThrow(AppError);
  });

  it('parseDraftIntake accepts sparse / empty intake for upload-first drafts', () => {
    expect(parseDraftIntake(undefined)).toEqual({
      age: 0,
      sex: '',
      specialtyContext: '',
      symptoms: '',
      symptomDuration: '',
      medicalHistory: '',
      currentMedications: '',
      allergies: '',
    });

    expect(
      parseDraftIntake({
        age: '',
        sex: '',
        specialtyContext: '',
        medicalHistory: '',
        currentMedications: '',
        allergies: '',
      })
    ).toMatchObject({
      age: 0,
      sex: '',
      specialtyContext: '',
    });
  });

  it('parseDraftIntake still validates age bounds when provided', () => {
    expect(() => parseDraftIntake({ age: 200 })).toThrow(AppError);
  });

  it('isIntakeCompleteForSubmit requires core demographics and history', () => {
    expect(isIntakeCompleteForSubmit(parseDraftIntake({}))).toBe(false);
    expect(isIntakeCompleteForSubmit(parseIntake(completeIntake))).toBe(true);
  });
});
