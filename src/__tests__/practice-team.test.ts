import { query } from '../database/connection';
import {
  createCaseInternalNote,
  listCaseInternalNotes,
} from '../services/caseInternalNotes.service';
import { getPracticeForDoctorUser } from '../services/practice.service';
import { AppError } from '../middleware/errorHandler';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('practice.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns practice with members for a doctor user', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'practice-1', name: 'Demo Practice', slug: 'demo' }],
      } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            doctor_id: 'doctor-1',
            first_name: 'John',
            last_name: 'Smith',
            specialty: 'Cardiology',
            role: 'attending',
          },
        ],
      } as any);

    const practice = await getPracticeForDoctorUser('user-1');

    expect(practice).toEqual({
      id: 'practice-1',
      name: 'Demo Practice',
      slug: 'demo',
      members: [
        {
          doctorId: 'doctor-1',
          firstName: 'John',
          lastName: 'Smith',
          specialty: 'Cardiology',
          role: 'attending',
        },
      ],
    });
  });

  it('returns null when the doctor has no practice', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    const practice = await getPracticeForDoctorUser('user-1');
    expect(practice).toBeNull();
  });
});

describe('caseInternalNotes.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists internal notes for an assigned doctor', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ doctor_id: 'doctor-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'note-1',
            case_id: 'case-1',
            author_doctor_id: 'doctor-1',
            note: 'Needs attending review',
            visibility: 'team',
            created_at: '2026-07-12T10:00:00.000Z',
            first_name: 'John',
            last_name: 'Smith',
          },
        ],
      } as any);

    const notes = await listCaseInternalNotes('case-1', 'user-1');

    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual(
      expect.objectContaining({
        id: 'note-1',
        note: 'Needs attending review',
        authorName: 'John Smith',
      })
    );
  });

  it('creates an internal note for an assigned doctor', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ doctor_id: 'doctor-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'note-2',
            case_id: 'case-1',
            author_doctor_id: 'doctor-1',
            note: 'Draft ready',
            visibility: 'team',
            created_at: '2026-07-12T11:00:00.000Z',
          },
        ],
      } as any)
      .mockResolvedValueOnce({
        rows: [{ first_name: 'John', last_name: 'Smith' }],
      } as any);

    const note = await createCaseInternalNote('case-1', 'user-1', 'Draft ready');

    expect(note.note).toBe('Draft ready');
    expect(note.authorName).toBe('John Smith');
  });

  it('rejects empty notes', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ doctor_id: 'doctor-1' }] } as any);

    await expect(createCaseInternalNote('case-1', 'user-1', '   ')).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({
        message: 'note is required',
        statusCode: 400,
      })
    );
  });
});
