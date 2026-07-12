import { query } from '../database/connection';
import { startCaseReview } from '../services/doctorCaseWorkflow.service';
import { AppError } from '../middleware/errorHandler';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('doctorCaseWorkflow.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts review for an assigned pending case', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'case-1',
            status: 'pending',
            title: 'Chest pain',
            patient_user_id: 'patient-user-1',
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await startCaseReview('case-1', 'doctor-user-1');

    expect(result).toEqual(
      expect.objectContaining({
        caseId: 'case-1',
        status: 'in_review',
      })
    );
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'in_review'"),
      ['case-1']
    );
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messages'),
      expect.arrayContaining(['case-1', 'doctor-user-1', 'patient-user-1'])
    );
  });

  it('rejects when the case is not assigned to the doctor', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(startCaseReview('case-1', 'doctor-user-1')).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({
        message: 'Case not found for assigned doctor',
        statusCode: 404,
      })
    );
  });

  it('rejects when the case is already in review', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'case-1',
          status: 'in_review',
          title: 'Chest pain',
          patient_user_id: 'patient-user-1',
        },
      ],
    } as any);

    await expect(startCaseReview('case-1', 'doctor-user-1')).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({
        message: 'Case is already in review or completed',
        statusCode: 400,
      })
    );
  });
});
