import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnection, mockGetPool, mockDeliverAlert } = vi.hoisted(() => {
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
    mockDeliverAlert: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('@/services/MySQLService', () => ({ getPool: mockGetPool }));
vi.mock('@/lib/runtimeIssueAlerts', () => ({ deliverPendingRuntimeIssueAlert: mockDeliverAlert }));

import { reportRuntimeIssue, runtimeIssueFingerprint, sanitizeRuntimeValue, serializeRuntimeContext } from '../runtimeIssues';

describe('runtime issue reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection.beginTransaction.mockResolvedValue(undefined);
    mockConnection.execute
      .mockResolvedValueOnce([{ insertId: 42 }, []])
      .mockResolvedValueOnce([{ insertId: 99 }, []]);
    mockConnection.commit.mockResolvedValue(undefined);
    mockConnection.rollback.mockResolvedValue(undefined);
    mockDeliverAlert.mockResolvedValue(true);
  });

  it('redacts nested credentials and bearer values', () => {
    expect(sanitizeRuntimeValue({
      access_token: 'secret-token',
      nested: { password: 'secret', note: 'Bearer abc.def.ghi' },
    })).toEqual({
      access_token: '[REDACTED]',
      nested: { password: '[REDACTED]', note: 'Bearer [REDACTED]' },
    });
  });

  it('uses a stable fingerprint across volatile numeric identifiers', () => {
    const first = runtimeIssueFingerprint({
      businessId: 'biz-1', source: 'xero', operation: 'po_bill', title: 'Failed', error: 'Invoice 12345 failed',
    });
    const second = runtimeIssueFingerprint({
      businessId: 'biz-1', source: 'xero', operation: 'po_bill', title: 'Failed', error: 'Invoice 98765 failed',
    });
    expect(first).toBe(second);
  });

  it('keeps oversized context valid JSON', () => {
    const serialized = serializeRuntimeContext({ payload: Array.from({ length: 20 }, () => 'x'.repeat(4_000)) });
    expect(serialized.length).toBeLessThanOrEqual(16_000);
    expect(JSON.parse(serialized)).toEqual(expect.objectContaining({ truncated: true }));
  });

  it('upserts the issue and appends an occurrence event', async () => {
    await expect(reportRuntimeIssue({
      businessId: 'biz-1',
      source: 'xero',
      operation: 'po_bill',
      title: 'PO bill failed',
      error: new Error('Xero rejected the invoice'),
      context: { authorization: 'Bearer unsafe', poId: 12 },
      reference: { type: 'purchase_order', id: 12 },
    })).resolves.toBe(42);

    expect(mockConnection.execute).toHaveBeenCalledTimes(2);
    expect(mockConnection.execute.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(mockConnection.execute.mock.calls[1][1][0]).toBe(42);
    expect(mockConnection.commit).toHaveBeenCalledOnce();
    expect(mockConnection.release).toHaveBeenCalledOnce();
  });

  it('does not throw when persistence fails', async () => {
    mockConnection.execute.mockReset().mockRejectedValueOnce(new Error('database unavailable'));
    await expect(reportRuntimeIssue({
      source: 'system', operation: 'test', title: 'Failure', error: 'boom',
    })).resolves.toBeNull();
    expect(mockConnection.rollback).toHaveBeenCalledOnce();
    expect(mockConnection.release).toHaveBeenCalledOnce();
  });

  it('returns the persisted issue when post-commit alert delivery throws', async () => {
    mockDeliverAlert.mockRejectedValueOnce(new Error('alert transport failed'));

    await expect(reportRuntimeIssue({
      source: 'system', operation: 'test', title: 'Failure', error: 'boom',
    })).resolves.toBe(42);

    expect(mockConnection.commit).toHaveBeenCalledOnce();
    expect(mockConnection.rollback).not.toHaveBeenCalled();
  });
});