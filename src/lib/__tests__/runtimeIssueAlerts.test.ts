import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnection, mockGetPool, mockQuery, mockExecute, mockSend } = vi.hoisted(() => {
  const connection = {
    beginTransaction: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  return {
    mockConnection: connection,
    mockGetPool: vi.fn(() => ({ getConnection: vi.fn().mockResolvedValue(connection) })),
    mockQuery: vi.fn(),
    mockExecute: vi.fn(),
    mockSend: vi.fn(),
  };
});

vi.mock('@/services/MySQLService', () => ({ getPool: mockGetPool, query: mockQuery, execute: mockExecute }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

import { deliverPendingRuntimeIssueAlert, retryPendingRuntimeIssueAlerts, sendRuntimeIssuesDailyDigest } from '../runtimeIssueAlerts';

const issue = {
  id: 7,
  business_name: 'Monsterthreads',
  source: 'xero',
  operation: 'po_bill',
  severity: 'critical',
  title: 'PO bill failed',
  message: 'Xero rejected the bill',
  occurrence_count: 2,
  last_seen_at: '2026-08-01T00:00:00.000Z',
};

describe('runtime issue alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('RESEND_API_KEY', 'resend-test-key');
    vi.stubEnv('RUNTIME_ISSUES_ALERT_EMAIL', 'developer@example.com');
    vi.stubEnv('APP_URL', 'https://solvantis.com.au');
    mockConnection.beginTransaction.mockResolvedValue(undefined);
    mockConnection.commit.mockResolvedValue(undefined);
    mockConnection.rollback.mockResolvedValue(undefined);
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  it('claims and sends one pending immediate alert', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[issue], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(deliverPendingRuntimeIssueAlert(7)).resolves.toBe(true);

    expect(mockConnection.commit).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0]).toEqual(expect.objectContaining({
      to: ['developer@example.com'],
      subject: '[CRITICAL] Runtime issue: PO bill failed',
    }));
  });

  it('does nothing when another worker already claimed the alert', async () => {
    mockConnection.execute.mockResolvedValueOnce([[], []]);

    await expect(deliverPendingRuntimeIssueAlert(7)).resolves.toBe(false);

    expect(mockConnection.rollback).toHaveBeenCalledOnce();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('restores the pending claim when email delivery fails', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[issue], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'Resend unavailable' } });

    await expect(deliverPendingRuntimeIssueAlert(7)).resolves.toBe(false);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('alert_pending = 1'),
      [7],
    );
  });

  it('sends a daily digest of unresolved issues', async () => {
    mockQuery.mockResolvedValueOnce([issue]);

    await expect(sendRuntimeIssuesDailyDigest(new Date('2026-08-01T21:00:00Z'))).resolves.toEqual({ sent: true, issueCount: 1 });

    expect(mockSend.mock.calls[0][1]).toEqual({ idempotencyKey: 'runtime-issues-digest-2026-08-01' });
  });

  it('retries bounded pending immediate alerts', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 7 }]);
    mockConnection.execute
      .mockResolvedValueOnce([[issue], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(retryPendingRuntimeIssueAlerts(10)).resolves.toEqual({ attempted: 1, sent: 1 });

    expect(mockQuery.mock.calls[0][0]).toContain('LIMIT 10');
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
