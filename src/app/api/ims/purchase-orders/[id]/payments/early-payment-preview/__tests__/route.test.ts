import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockGet } = vi.hoisted(() => ({ mockSession: vi.fn(), mockGet: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsPORepo: { get: mockGet } }));

import { POST } from '../route';

const request = () => new Request('http://localhost/api/ims/purchase-orders/42/payments/early-payment-preview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payment_date: '2026-09-11', amount: 104.5, total_amount: 1 }),
});

describe('POST purchase-order early-payment preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1' });
    mockGet.mockResolvedValue({
      early_payment_discount_name: '5% in 10 days',
      early_payment_discount_basis_points: 500,
      early_payment_discount_cutoff_date: '2026-09-11',
      tax_treatment: 'inc_tax',
      total_amount: 110,
      items: [{ line_total: 110, tax_rate: 0.1 }],
      payments: [],
    });
  });

  it('loads the tenant order and ignores request-supplied order totals', async () => {
    const response = await POST(request() as any, { params: { id: '42' } });
    const payload = await response.json();

    expect(mockGet).toHaveBeenCalledWith(42, 'biz-1');
    expect(payload.data).toMatchObject({ discountedSettlementCents: 10450, eligible: true });
  });
});