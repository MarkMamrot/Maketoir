import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockImsQuery } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { GET } from '../route';

describe('GET /api/ims/backorders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires an IMS session', async () => {
    mockSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mockImsQuery).not.toHaveBeenCalled();
  });

  it('returns tenant-scoped queues with customer readiness', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1' });
    mockImsQuery
      .mockResolvedValueOnce([{ id: 11, order_number: 'SO-11', contact_name: 'Acme' }])
      .mockResolvedValueOnce([{ id: 22, order_number: 'PO-22', contact_name: 'Supplier' }])
      .mockResolvedValueOnce([{ order_id: 11, item_id: 1, qty_ordered: 2, qty_on_hand: 5, qty_committed: 4 }])
      .mockResolvedValueOnce([{ order_id: 22, item_id: 2, qty_ordered: 7, qty_on_hand: 0, qty_committed: 0, qty_incoming: 7 }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.customer[0]).toMatchObject({ ready: true, item_count: 1, total_qty: 2, type: 'customer' });
    expect(body.data.supplier[0]).toMatchObject({ ready: false, item_count: 1, total_qty: 7, type: 'supplier' });
    expect(mockImsQuery).toHaveBeenCalledTimes(4);
    expect(mockImsQuery.mock.calls.every(([, params]) => params[0] === 'biz-1')).toBe(true);
  });
});