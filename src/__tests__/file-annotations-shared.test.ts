import { buildSharedAnnotationState, type DicomAnnotationPayload } from '../services/dicomImaging.service';

const base = (id: string, text?: string): DicomAnnotationPayload => ({
  id,
  type: 'text',
  points: [{ x: 1, y: 2 }],
  color: '#ff0000',
  text,
});

describe('buildSharedAnnotationState', () => {
  it('stamps authors on create and records audit events', () => {
    const { annotations, events } = buildSharedAnnotationState(
      [],
      [base('a1', 'note')],
      'user-1',
      'Dr Smith',
      '2026-07-14T12:00:00.000Z'
    );

    expect(annotations).toHaveLength(1);
    expect(annotations[0].createdByUserId).toBe('user-1');
    expect(annotations[0].createdByName).toBe('Dr Smith');
    expect(events).toEqual([
      {
        annotationId: 'a1',
        action: 'created',
        before: null,
        after: annotations[0],
      },
    ]);
  });

  it('preserves original author on update and records deleted ids', () => {
    const prior = {
      ...base('a1', 'old'),
      createdByUserId: 'user-1',
      createdByName: 'Dr Smith',
      createdAt: '2026-07-14T10:00:00.000Z',
      updatedByUserId: 'user-1',
      updatedAt: '2026-07-14T10:00:00.000Z',
    };
    const extra = {
      ...base('a2', 'gone'),
      createdByUserId: 'user-2',
      createdByName: 'Dr Jones',
      createdAt: '2026-07-14T11:00:00.000Z',
    };

    const { annotations, events } = buildSharedAnnotationState(
      [prior, extra],
      [base('a1', 'new')],
      'user-3',
      'Dr Lee',
      '2026-07-14T12:00:00.000Z'
    );

    expect(annotations).toHaveLength(1);
    expect(annotations[0].createdByUserId).toBe('user-1');
    expect(annotations[0].createdByName).toBe('Dr Smith');
    expect(annotations[0].updatedByUserId).toBe('user-3');
    expect(annotations[0].text).toBe('new');

    expect(events.map((event) => event.action).sort()).toEqual(['deleted', 'updated']);
    expect(events.find((event) => event.action === 'deleted')?.annotationId).toBe('a2');
  });

  it('skips audit when geometry is unchanged', () => {
    const prior = {
      ...base('a1', 'same'),
      createdByUserId: 'user-1',
      createdByName: 'Dr Smith',
      createdAt: '2026-07-14T10:00:00.000Z',
    };

    const { annotations, events } = buildSharedAnnotationState(
      [prior],
      [base('a1', 'same')],
      'user-2',
      'Dr Jones',
      '2026-07-14T12:00:00.000Z'
    );

    expect(events).toHaveLength(0);
    expect(annotations[0]).toEqual(prior);
  });
});
