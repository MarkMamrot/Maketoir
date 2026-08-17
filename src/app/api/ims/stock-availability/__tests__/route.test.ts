import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockImsQuery, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockImsQuery: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { GET } from '../route';

describe('GET /api/ims/stock-availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReportRuntimeIssue.mockResolvedValue(undefined);
  });

  it('requires an IMS session', async () => {
    mockSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mockImsQuery).not.toHaveBeenCalled();
  });

  it('returns classified open stock demand and summary counts', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1' });
    mockImsQuery.mockResolvedValue([{
      so_id: 11, so_item_id: 12, so_number: 'SO-11', status: 'confirmed',
      qty_ordered: '10', qty_fulfilled: '2', qty_allocated: '7',
      qty_received_assigned: '4', allocation_qty_fulfilled: '1',
      qty_on_hand: '5', qty_committed: '8', qty_incoming: '7', allocation_count: '2',
      at_risk_count: '0', earliest_incoming_date: '2026-09-01',
    }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      outstanding: 8, protected: 6, ready: 3, incoming: 3, unsourced: 2,
      qty_on_hand: 5, qty_committed: 8, allocation_count: 2,
      issues: ['unsourced', 'ready', 'incoming'],
    });
    expect(body.summary).toMatchObject({ total: 1, counts: { unsourced: 1, ready: 1, incoming: 1, at_risk: 0 } });
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', 'biz-1', 'biz-1', 'biz-1']);
    expect(String(mockImsQuery.mock.calls[0][0])).toContain('po.business_id COLLATE utf8mb4_general_ci = a.business_id COLLATE utf8mb4_general_ci');
  });

  it('reports operational query failures', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1' });
    mockImsQuery.mockRejectedValue(new Error('query failed'));

    const response = await GET();
    expect(response.status).toBe(500);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', source: 'ims_stock_availability', operation: 'load_workbench',
    }));
  });
});