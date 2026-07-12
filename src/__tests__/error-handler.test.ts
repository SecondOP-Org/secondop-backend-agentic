import { errorHandler, AppError } from '../middleware/errorHandler';

const createMockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('errorHandler postgres mapping', () => {
  it('maps invalid uuid syntax to a 400 case ID error', () => {
    const req = { path: '/api/v1/cases/bad/analysis/trace', method: 'GET', requestId: 'req-1' } as any;
    const res = createMockResponse();
    const next = jest.fn();
    const err = Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        message: expect.stringContaining('Invalid case ID format'),
      })
    );
  });

  it('maps missing columns to a migration hint', () => {
    const req = { path: '/api/v1/cases/uuid/analysis/trace', method: 'GET', requestId: 'req-2' } as any;
    const res = createMockResponse();
    const next = jest.fn();
    const err = Object.assign(new Error('column "error_message" does not exist'), { code: '42703' });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        message: expect.stringContaining('migrations (011+)'),
      })
    );
  });

  it('keeps operational AppError responses unchanged', () => {
    const req = { path: '/api/v1/cases/uuid/analysis/trace', method: 'GET', requestId: 'req-3' } as any;
    const res = createMockResponse();
    const next = jest.fn();

    errorHandler(new AppError('You do not have access to this case', 403), req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'You do not have access to this case',
      })
    );
  });
});
