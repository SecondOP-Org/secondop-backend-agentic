import { getReleaseMetadata } from '../config/releaseMetadata';
import { buildHealthResponse, getVersion } from '../controllers/version.controller';

const createResponse = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);

  return res;
};

describe('release metadata', () => {
  it('returns safe release and build metadata from environment variables', () => {
    const metadata = getReleaseMetadata({
      SECONDOP_RELEASE_VERSION: '0.1.0',
      BACKEND_PACKAGE_VERSION: '1.0.0',
      BACKEND_GIT_SHA: 'abcdef1234567890',
      BACKEND_BUILD_TIME: '2026-06-25T23:00:00.000Z',
      APP_ENV: 'staging',
      API_VERSION: 'v1',
      BACKEND_DEPLOYMENT_ID: 'railway-deploy-123',
    });

    expect(metadata).toEqual({
      productVersion: '0.1.0',
      backendVersion: '1.0.0',
      gitSha: 'abcdef1234567890',
      buildTime: '2026-06-25T23:00:00.000Z',
      environment: 'staging',
      apiVersion: 'v1',
      deploymentId: 'railway-deploy-123',
    });
  });

  it('falls back instead of returning unsafe or secret-like metadata values', () => {
    const metadata = getReleaseMetadata({
      SECONDOP_RELEASE_VERSION: '0.1.0 secret-token',
      BACKEND_PACKAGE_VERSION: '1.0.0',
      BACKEND_GIT_SHA: 'sk-test-secret',
      BACKEND_BUILD_TIME: 'postgres://user:password@example.com/db',
      APP_ENV: 'production;cat-secret',
      API_VERSION: 'v1/private',
      BACKEND_DEPLOYMENT_ID: 'deploy id with spaces',
      JWT_SECRET: 'must-not-appear',
      DATABASE_URL: 'postgres://user:password@example.com/db',
    });

    expect(metadata).toMatchObject({
      productVersion: '0.0.0-dev',
      backendVersion: '1.0.0',
      gitSha: 'unknown',
      buildTime: 'unknown',
      environment: 'development',
      apiVersion: 'v1',
      deploymentId: 'unknown',
    });
    expect(JSON.stringify(metadata)).not.toContain('must-not-appear');
    expect(JSON.stringify(metadata)).not.toContain('postgres://');
    expect(JSON.stringify(metadata)).not.toContain('sk-test-secret');
  });

  it('builds the health response with release metadata', () => {
    const response = buildHealthResponse();

    expect(response).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      version: expect.objectContaining({
        productVersion: expect.any(String),
        backendVersion: expect.any(String),
        gitSha: expect.any(String),
        buildTime: expect.any(String),
        environment: expect.any(String),
        apiVersion: expect.any(String),
        deploymentId: expect.any(String),
      }),
    });
  });

  it('returns the version endpoint response shape', () => {
    const res = createResponse();

    getVersion({} as never, res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: expect.objectContaining({
        productVersion: expect.any(String),
        backendVersion: expect.any(String),
        gitSha: expect.any(String),
        buildTime: expect.any(String),
        environment: expect.any(String),
        apiVersion: expect.any(String),
        deploymentId: expect.any(String),
      }),
    });
  });
});
