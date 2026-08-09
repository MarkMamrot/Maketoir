import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockGet, mockAddPayment, mockXeroSync } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockGet: vi.fn(),
  mockAddPayment: vi.fn(),
  mockXeroSync: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsPORepo: { get: mockGet, addPayment: mockAddPayment },
}));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerPOPaymentXeroSync: mockXeroSync }));

import { POST } from '../route';

const request = () => new Request('http://localhost/api/ims/purchase-orders/42/payments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payment_date: '2026-08-09', amount: 10, payment_method_id: 3 }),
});

describe('POST /api/ims/purchase-orders/[id]/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1' });
  });

  it('blocks payments while a supplier backorder is held', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'backordered' });

    const response = await POST(request() as any, { params: { id: '42' } });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Release this supplier backorder');
    expect(mockAddPayment).not.toHaveBeenCalled();
    expect(mockXeroSync).not.toHaveBeenCalled();
  });
});
