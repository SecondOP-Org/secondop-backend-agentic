/** Case statuses visible in a doctor's submitted-case inbox. */
export const DOCTOR_INBOX_CASE_STATUSES = [
  'pending',
  'in_review',
  'in_progress',
  'awaiting_patient',
  'completed',
] as const;

export const DEFAULT_TURNAROUND_DAYS = 3;

export const resolveEffectiveDueDate = (
  dueDate: string | Date | null | undefined,
  submittedDate: string | Date | null | undefined
): Date | null => {
  if (dueDate) {
    const parsed = new Date(dueDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (!submittedDate) {
    return null;
  }

  const submitted = new Date(submittedDate);
  if (Number.isNaN(submitted.getTime())) {
    return null;
  }

  const effective = new Date(submitted);
  effective.setDate(effective.getDate() + DEFAULT_TURNAROUND_DAYS);
  return effective;
};

export const isDueToday = (dueDate: Date | null): boolean => {
  if (!dueDate) {
    return false;
  }

  const today = new Date();
  return (
    dueDate.getFullYear() === today.getFullYear() &&
    dueDate.getMonth() === today.getMonth() &&
    dueDate.getDate() === today.getDate()
  );
};

export const isOverdue = (dueDate: Date | null, status: string): boolean => {
  if (!dueDate || status === 'completed') {
    return false;
  }

  const endOfDueDay = new Date(dueDate);
  endOfDueDay.setHours(23, 59, 59, 999);
  return endOfDueDay.getTime() < Date.now();
};
