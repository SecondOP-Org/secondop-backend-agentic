import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import * as healthMetricsController from '../controllers/healthMetrics.controller';
import * as appointmentController from '../controllers/appointment.controller';
import * as prescriptionController from '../controllers/prescription.controller';
import * as labResultsController from '../controllers/labResults.controller';
import * as doctorController from '../controllers/doctor.controller';
import * as userController from '../controllers/user.controller';
import * as billingController from '../controllers/billing.controller';
import * as messageController from '../controllers/message.controller';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

const mockRes = () => {
  const res: {
    statusCode?: number;
    body?: unknown;
    status: jest.Mock;
    json: jest.Mock;
  } = {
    status: jest.fn().mockImplementation(function status(this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn().mockImplementation(function json(this: typeof res, body: unknown) {
      this.body = body;
      return this;
    }),
  };
  return res;
};

const authReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    user: { id: 'user-1', email: 'p@example.com', type: 'patient' },
    params: {},
    query: {},
    body: {},
    app: {
      get: jest.fn().mockReturnValue({
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      }),
    },
    ...overrides,
  }) as AuthRequest;

describe('SEC-209 repository pattern controller flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('healthMetrics: add + list preserve response shapes', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'patient-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [{ id: 'metric-1', metric_type: 'weight', value: 70 }],
      } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'patient-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [{ id: 'metric-1', metric_type: 'weight', value: 70 }],
      } as any);

    const addRes = mockRes();
    await healthMetricsController.addHealthMetric(
      authReq({ body: { metricType: 'weight', value: 70, unit: 'kg', notes: '' } }),
      addRes as any,
      jest.fn()
    );
    expect(addRes.status).toHaveBeenCalledWith(201);
    expect(addRes.body).toEqual({
      status: 'success',
      data: { id: 'metric-1', metric_type: 'weight', value: 70 },
    });

    const listRes = mockRes();
    await healthMetricsController.getHealthMetrics(authReq(), listRes as any, jest.fn());
    expect(listRes.body).toEqual({
      status: 'success',
      data: [{ id: 'metric-1', metric_type: 'weight', value: 70 }],
    });
  });

  it('appointment: create for patient preserves 201 payload', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'patient-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [{ id: 'appt-1', status: 'scheduled' }],
      } as any);

    const res = mockRes();
    await appointmentController.createAppointment(
      authReq({
        body: {
          doctorId: 'doc-1',
          caseId: 'case-1',
          appointmentDate: '2026-08-10T10:00:00Z',
          appointmentType: 'video',
          notes: 'n',
        },
      }),
      res as any,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({
      status: 'success',
      data: { id: 'appt-1', status: 'scheduled' },
    });
  });

  it('prescription: list for patient uses patient id lookup', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'patient-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'rx-1' }] } as any);

    const res = mockRes();
    await prescriptionController.getPrescriptions(authReq(), res as any, jest.fn());
    expect(res.body).toEqual({ status: 'success', data: [{ id: 'rx-1' }] });
    expect(mockedQuery.mock.calls[1][0]).toMatch(/patient_id = \$1/);
  });

  it('labResults: get by id returns 404 when missing', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
    const next = jest.fn();
    await labResultsController.getLabResultById(
      authReq({ params: { labResultId: 'missing' } }),
      mockRes() as any,
      next
    );
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.message).toBe('Lab result not found');
    expect(err.statusCode).toBe(404);
  });

  it('doctor: getDoctors applies safe specialty filter binding', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'doc-1', specialty: 'Cardiology' }] } as any);
    const res = mockRes();
    await doctorController.getDoctors(
      authReq({ query: { specialty: 'Cardiology' } }),
      res as any,
      jest.fn()
    );
    expect(res.body).toEqual({
      status: 'success',
      data: [{ id: 'doc-1', specialty: 'Cardiology' }],
    });
    expect(mockedQuery.mock.calls[0][0]).toContain('d.specialty = $1');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['Cardiology']);
  });

  it('user: getProfile returns patient profile', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-1', email: 'p@example.com', first_name: 'Pat' }],
    } as any);
    const res = mockRes();
    await userController.getProfile(authReq(), res as any, jest.fn());
    expect(res.body).toEqual({
      status: 'success',
      data: { id: 'user-1', email: 'p@example.com', first_name: 'Pat' },
    });
  });

  it('billing: getSubscriptionPlans and getPaymentMethods preserve shapes', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'plan-1', price: 99 }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'pm-1' }] } as any);

    const plansRes = mockRes();
    await billingController.getSubscriptionPlans(authReq(), plansRes as any, jest.fn());
    expect(plansRes.body).toEqual({
      status: 'success',
      data: [{ id: 'plan-1', price: 99 }],
    });

    const methodsRes = mockRes();
    await billingController.getPaymentMethods(authReq(), methodsRes as any, jest.fn());
    expect(methodsRes.body).toEqual({
      status: 'success',
      data: [{ id: 'pm-1' }],
    });
  });

  it('message: sendMessage checks access then inserts and emits', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as any) // assertCaseAccess
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as any) // assertParticipant
      .mockResolvedValueOnce({
        rows: [{ id: 'msg-1', content: 'hello', case_id: 'case-1' }],
      } as any);

    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const res = mockRes();
    await messageController.sendMessage(
      authReq({
        body: { caseId: 'case-1', receiverId: 'user-2', content: 'hello' },
        app: { get: jest.fn().mockReturnValue({ to }) } as any,
      }),
      res as any,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({
      status: 'success',
      data: { id: 'msg-1', content: 'hello', case_id: 'case-1' },
    });
    expect(to).toHaveBeenCalledWith('case-case-1');
    expect(emit).toHaveBeenCalledWith('new-message', {
      id: 'msg-1',
      content: 'hello',
      case_id: 'case-1',
    });
  });

  it('message: markAsRead returns 404 when no row updated', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
    const next = jest.fn();
    await messageController.markAsRead(
      authReq({ params: { messageId: 'msg-x' } }),
      mockRes() as any,
      next
    );
    expect(next.mock.calls[0][0].message).toBe('Message not found');
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});
