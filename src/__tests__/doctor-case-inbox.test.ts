import {
  DEFAULT_TURNAROUND_DAYS,
  isDueToday,
  isOverdue,
  resolveEffectiveDueDate,
} from '../services/doctorCaseInbox.service';

describe('doctorCaseInbox.service', () => {
  it('defaults due date to submitted date plus turnaround days', () => {
    const submitted = '2026-07-01T12:00:00.000Z';
    const due = resolveEffectiveDueDate(null, submitted);
    expect(due?.toISOString().slice(0, 10)).toBe('2026-07-04');
  });

  it('uses persisted due date when present', () => {
    const due = resolveEffectiveDueDate('2026-07-10T00:00:00.000Z', '2026-07-01T12:00:00.000Z');
    expect(due?.toISOString().slice(0, 10)).toBe('2026-07-10');
  });

  it('flags overdue pending cases', () => {
    const due = new Date('2020-01-01T00:00:00.000Z');
    expect(isOverdue(due, 'pending')).toBe(true);
    expect(isOverdue(due, 'completed')).toBe(false);
  });

  it('detects due today', () => {
    const today = new Date();
    expect(isDueToday(today)).toBe(true);
    expect(isDueToday(new Date('2000-01-01'))).toBe(false);
  });

  it('uses three-day default turnaround constant', () => {
    expect(DEFAULT_TURNAROUND_DAYS).toBe(3);
  });
});
