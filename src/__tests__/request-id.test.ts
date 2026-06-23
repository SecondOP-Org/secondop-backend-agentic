import { AppError, errorHandler } from '../middleware/errorHandler';
import {
  REQUEST_ID_HEADER,
  normalizeRequestId,
  requestIdMiddleware,
} from '../middleware/requestId';

jest.mock('../utils/logger', () => ({
  error: jest.fn(),
}));

type TestRequest = {
  get: jest.Mock;
  method?: string;
  path?: string;
  requestId?: string;
};

const createResponse = () => {
  const res = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);

  return res;
};

describe('requestIdMiddleware', () => {
  it('uses an inbound X-Request-ID and echoes it on the response', () => {
    const req: TestRequest = {
      get: jest.fn().mockReturnValue(' client-request-1 '),
    };
    const res = createResponse();
    const next = jest.fn();

    requestIdMiddleware(req as any, res as any, next);

    expect(req.requestId).toBe('client-request-1');
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'client-request-1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a request ID when the inbound header is absent', () => {
    const req: TestRequest = {
      get: jest.fn().mockReturnValue(undefined),
    };
    const res = createResponse();
    const next = jest.fn();

    requestIdMiddleware(req as any, res as any, next);

    expect(req.requestId).toEqual(expect.any(String));
    expect(req.requestId).toHaveLength(36);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('normalizes unsafe request ID characters before logging or echoing', () => {
    expect(normalizeRequestId(' request\nid\t1\r ')).toBe('requestid1');
  });
});

describe('errorHandler request IDs', () => {
  it('includes the request ID in operational error responses', () => {
    const req = {
      method: 'GET',
      path: '/api/v1/example',
      requestId: 'request-123',
    };
    const res = createResponse();

    errorHandler(new AppError('Bad input', 400), req as any, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Bad input',
      requestId: 'request-123',
    });
  });
});
