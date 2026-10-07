import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dailyTransactions } = vi.hoisted(() => ({ dailyTransactions: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: JSON.stringify({ location_id: 1 }) }) }) }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: vi.fn().mockResolvedValue({ businessId: 'business-1' }) }));
vi.mock('@/lib/db/PosRepository', () => ({ PosReportsRepo: { dailyTransactions } }));
import { GET } from '../route';

describe('POS daily layby report', () => {
  beforeEach(() => dailyTransactions.mockReset());
  it('shows the actual deposit in card takings but not the full active layby in revenue', async () => {
    dailyTransactions.mockResolvedValue([
      { sale: { id: 586370, status: 'layby_active', total: 129.95 }, items: [], payments: [{ payment_method: 'Card', amount: 26 }] },
      { sale: { id: 2, status: 'completed', total: 50 }, items: [], payments: [{ payment_method: 'Card', amount: 50 }] },
    ]);
    const response = await GET(new Request('http://localhost/api/pos/reports/daily?location_id=1&date=2026-10-07'));
    const result = await response.json();
    expect(result.transactions).toHaveLength(2);
    expect(result.summary).toEqual({ total_revenue: 50, total_count: 2, by_method: { Card: 76 } });
  });
});