import os from 'os';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { getLatestLedgers, getSummary } from '../controllers/commandCenter.controller';
import { authorizeCommandCenterOperator } from '../middleware/commandCenterAuth';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const originalEnv = process.env;

const createResponse = () => {
  const res = {
    json: jest.fn(),
  };
  res.json.mockReturnValue(res);
  return res;
};

const createOperatorRequest = (email = 'operator@example.com'): AuthRequest => {
  return {
    requestId: 'command-center-test',
    user: {
      id: 'operator-user',
      email,
      type: 'doctor',
    },
    params: {},
  } as unknown as AuthRequest;
};

const writeLedger = (content: string): string => {
  const dir = path.join(os.tmpdir(), 'secondop-command-center-tests');
  mkdirSync(dir, { recursive: true });
  const ledgerPath = path.join(dir, `ledger-${Date.now()}-${Math.random()}.md`);
  writeFileSync(ledgerPath, content);
  return ledgerPath;
};

describe('command-center operator authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      COMMAND_CENTER_OPERATOR_EMAILS: 'operator@example.com',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('requires authentication', () => {
    const next = jest.fn();

    authorizeCommandCenterOperator({} as AuthRequest, {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects authenticated users outside the operator allowlist', () => {
    const next = jest.fn();

    authorizeCommandCenterOperator(createOperatorRequest('doctor@example.com'), {} as never, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('allows configured operators', () => {
    const next = jest.fn();

    authorizeCommandCenterOperator(createOperatorRequest(), {} as never, next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe('command-center controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      COMMAND_CENTER_OPERATOR_EMAILS: 'operator@example.com',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a sanitized summary for configured operators', () => {
    const ledgerPath = writeLedger(`# Agent Run Ledger

## 2026-06-24 - SEC-99 - Test command center

- Status: In progress.
- Human approval: User approved a test.
- Branch/worktree: \`sec-99-test\`, \`.worktrees/sec-99\`.
- Files changed: \`src/example.ts\`.
- PR: https://github.com/SecondOP-Org/secondop-backend-agentic/pull/99.
- Checks: \`npm test\` passed.
- Deployment: None.
- Verification: Sanitizer saw SECRET_KEY=super-secret-value and postgresql://user:pass@example.com/db.
- Blockers: None.
- Follow-ups: Wait for human review/approval before merge.
`);
    process.env.COMMAND_CENTER_BACKEND_LEDGER_PATH = ledgerPath;

    const res = createResponse();
    const next = jest.fn();

    getSummary(createOperatorRequest(), res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: expect.objectContaining({
        audit: expect.objectContaining({
          requestId: 'command-center-test',
          generatedByUserId: 'operator-user',
          redactionVersion: 'command-center-redaction-v1',
        }),
        items: expect.arrayContaining([
          expect.objectContaining({
            issue: expect.objectContaining({ key: 'SEC-99', title: 'Test command center' }),
            pr: expect.objectContaining({
              url: 'https://github.com/SecondOP-Org/secondop-backend-agentic/pull/99',
            }),
            repoScope: 'backend',
            humanAction: 'Wait for human review/approval before merge.',
          }),
        ]),
        agents: expect.arrayContaining([
          expect.objectContaining({
            role: 'pr_review',
            label: 'PR review agent',
            status: 'waiting_for_human',
            evidence: expect.arrayContaining([
              expect.stringContaining('SEC-99'),
            ]),
          }),
          expect.objectContaining({
            role: 'command_center',
            label: 'Command-center/status agent',
            status: 'active',
          }),
        ]),
      }),
    });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('super-secret-value');
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('postgresql://user:pass@example.com/db');
    expect(JSON.stringify(res.json.mock.calls[0][0])).toContain('[REDACTED]');
  });

  it('returns latest sanitized ledgers through the ledger controller', () => {
    process.env.COMMAND_CENTER_BACKEND_LEDGER_PATH = writeLedger(`# Agent Run Ledger

## 2026-06-24 - SEC-100 - Ledger endpoint

- Status: Done.
- Checks: \`npm test\` passed.
- Deployment: Backend production deployment succeeded.
- Verification: Done.
- Blockers: None.
- Follow-ups: None.
`);
    const res = createResponse();
    const next = jest.fn();

    getLatestLedgers(createOperatorRequest(), res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: expect.arrayContaining([
        expect.objectContaining({
          issueKey: 'SEC-100',
          title: 'Ledger endpoint',
          checks: '`npm test` passed.',
        }),
      ]),
    });
  });

  it('passes unexpected controller errors to next', () => {
    const next = jest.fn();
    const badRequest = {
      ...createOperatorRequest(),
      user: undefined,
    } as unknown as AuthRequest;

    getSummary(badRequest, createResponse() as never, next);

    expect(next.mock.calls[0][0]).not.toBeInstanceOf(AppError);
  });
});
