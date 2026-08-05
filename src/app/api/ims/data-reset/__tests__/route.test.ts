import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockQuery, mockImsExecute } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockQuery: vi.fn(),
  mockImsExecute: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ query: mockQuery }),
  imsExecute: mockImsExecute,
}));

import { POST } from '../route';

function request(targets: string[]): any {
  return new Request('http://localhost/api/ims/data-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE', targets }),
  });
}

describe('POST /api/ims/data-reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'biz-1' });
    mockImsExecute.mockResolvedValue({ affectedRows: 0 });
  });

  it('blocks PO reset before deleting anything when posted POs exist', async () => {
    mockQuery.mockResolvedValueOnce([[{ count: 3 }]]);

    const response = await POST(request(['purchase_orders']));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Purchase orders cannot be reset while confirmed, received, complete, or cancelled POs exist. Only draft POs may be permanently deleted.',
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(String(mockQuery.mock.calls[0][0])).toContain("status <> 'draft'");
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('allows the reset when every PO is still a draft', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ count: 0 }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 2 }]);

    const response = await POST(request(['purchase_orders']));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, deleted: { purchase_orders: 2 } });
    expect(mockImsExecute).toHaveBeenCalledWith(
      'DELETE FROM ims_xero_sync_log WHERE business_id = ?',
      ['biz-1'],
    );
  });
});