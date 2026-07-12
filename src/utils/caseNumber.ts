import { v4 as uuidv4 } from 'uuid';

/** Short patient-facing reference, e.g. SO-A1B2C3D4 */
export const generateCaseNumber = (): string => {
  const suffix = uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `SO-${suffix}`;
};
