/** Constrained specialty list for doctor signup (SEC-169). */
export const DOCTOR_SPECIALTIES = [
  'Cardiology',
  'Oncology',
  'Neurology',
  'Radiology',
  'Orthopedics',
  'Dermatology',
  'Endocrinology',
  'Gastroenterology',
  'Pulmonology',
  'Nephrology',
  'Urology',
  'Ophthalmology',
  'Psychiatry',
  'Rheumatology',
  'Hematology',
  'Infectious Disease',
  'General Surgery',
  'Internal Medicine',
  'Pediatrics',
  'Obstetrics and Gynecology',
] as const;

export type DoctorSpecialty = (typeof DOCTOR_SPECIALTIES)[number];

const specialtySet = new Set<string>(DOCTOR_SPECIALTIES.map((s) => s.toLowerCase()));

export const isAllowedDoctorSpecialty = (value: string): boolean => {
  return specialtySet.has(value.trim().toLowerCase());
};

export const normalizeDoctorSpecialty = (value: string): string | null => {
  const trimmed = value.trim();
  const match = DOCTOR_SPECIALTIES.find((s) => s.toLowerCase() === trimmed.toLowerCase());
  return match ?? null;
};
