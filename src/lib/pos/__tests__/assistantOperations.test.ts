import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockImsQuery,
  mockGetCurrent,
  mockGetDayTotalsBySession,
  mockGetExpectedBySession,
  mockGetBySession,
} = vi.hoisted(() => ({
  mockImsQuery: vi.fn(),
  mockGetCurrent: vi.fn(),
  mockGetDayTotalsBySession: vi.fn(),
  mockGetExpectedBySession: vi.fn(),
  mockGetBySession: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/db/PosRepository', () => ({
  PosRegisterSessionRepo: { getCurrent: mockGetCurrent },
  PosEodRepo: {
    getDayTotalsBySession: mockGetDayTotalsBySession,
    getExpectedBySession: mockGetExpectedBySession,
    getBySession: mockGetBySession,
  },
}));

import { loadPosRecentTransactions, loadPosRegisterStatus } from '../assistantOperations';

const scope = { businessId: 'biz-1', locationId: 4, registerId: 9 };

describe('POS Assistant operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('summarises only the verified open register session and nets petty cash from expected cash', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 9, name: 'Front Till', location_id: 4, location_name: 'Main' }]);
    mockGetCurrent.mockResolvedValueOnce({
      id: 21, register_id: 9, location_id: 4, session_date: '2026-09-05',
      opened_at: '2026-09-05 08:00:00', closed_at: null, opening_float: 200,
      denomination_data: null, status: 'open', opened_by: null, closed_by: null,
    });
    mockGetDayTotalsBySession.mockResolvedValueOnce({
      sale_count: 5, total_inc_tax: 550, tax_total: 50, total_exc_tax: 500,
    });
    mockGetExpectedBySession.mockResolvedValueOnce({ Cash: 200, Card: 330 });
    mockImsQuery.mockResolvedValueOnce([{ amount: '20' }]);
    mockGetBySession.mockResolvedValueOnce([{ counted_amount: null }]);

    const result = await loadPosRegisterStatus(scope);

    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', 9, 4]);
    expect(mockGetCurrent).toHaveBeenCalledWith(9);
    const fallback = { locationId: 4, date: '2026-09-05', registerId: 9 };
    expect(mockGetDayTotalsBySession).toHaveBeenCalledWith(21, fallback);
    expect(mockGetExpectedBySession).toHaveBeenCalledWith(21, fallback);
    expect(mockGetBySession).toHaveBeenCalledWith(21, fallback);
    expect(mockImsQuery.mock.calls[1][1]).toEqual(['biz-1', 4, 9, 21]);
    expect(result).toMatchObject({
      registerId: 9,
      locationId: 4,
      status: 'open',
      session: {
        sessionId: 21,
        saleCount: 5,
        salesTotalTaxInclusive: 550,
        gst: 50,
        salesTotalTaxExclusive: 500,
        pettyCash: 20,
        expectedByPaymentMethod: { Cash: 200, Card: 330 },
        countsSaved: false,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/customer|cashier|phone|email/i);
  });

  it('returns a closed status without reading sales when no session is open', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 9, name: 'Front Till', location_id: 4, location_name: 'Main' }]);
    mockGetCurrent.mockResolvedValueOnce(null);

    await expect(loadPosRegisterStatus(scope)).resolves.toMatchObject({ status: 'closed', session: null });
    expect(mockImsQuery).toHaveBeenCalledTimes(1);
    expect(mockGetDayTotalsBySession).not.toHaveBeenCalled();
  });

  it('returns bounded anonymous transactions directly or indirectly assigned to the verified register', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ id: 9, name: 'Front Till', location_id: 4, location_name: 'Main' }])
      .mockResolvedValueOnce([{
        id: 80, sale_type: 'sale', status: 'completed', total: '110', tax_total: '10',
        discount_total: '5', completed_at: '2026-09-05 10:00:00', line_count: '2', unit_count: '3',
        payment_methods: 'Card, Gift Card',
      }]);

    const result = await loadPosRecentTransactions({ ...scope, days: 7, limit: 20 });

    expect(mockImsQuery.mock.calls[1][0]).toContain('SELECT COUNT(*) FROM pos_sale_items');
    expect(mockImsQuery.mock.calls[1][0]).toContain('EXISTS (');
    expect(mockImsQuery.mock.calls[1][0]).toContain('LIMIT 21');
    expect(mockImsQuery.mock.calls[1][1]).toEqual([
      'biz-1', 'biz-1', 'biz-1',
      'biz-1', 4, 9, 'biz-1', 4, 9, 4, 7,
    ]);
    expect(result).toMatchObject({
      registerId: 9,
      locationId: 4,
      rows: [{
        saleId: 80, totalTaxInclusive: 110, gst: 10, lineCount: 2, unitCount: 3,
        paymentMethods: ['Card', 'Gift Card'],
      }],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/customer|cashier|phone|email|notes/i);
  });
});
