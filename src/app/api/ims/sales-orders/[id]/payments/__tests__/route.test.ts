import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockGet, mockAddPayment, mockXeroSync } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockGet: vi.fn(),
  mockAddPayment: vi.fn(),
  mockXeroSync: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSORepo: { get: mockGet, addPayment: mockAddPayment },
}));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerSOPaymentXeroSync: mockXeroSync }));

import { POST } from '../route';

const request = (overrides: Record<string, unknown> = {}) => new Request('http://localhost/api/ims/sales-orders/42/payments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payment_date: '2026-08-09', amount: 10, payment_method_id: 3, ...overrides }),
});

describe('POST /api/ims/sales-orders/[id]/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1' });
    mockAddPayment.mockResolvedValue({ id: 8 });
  });

  it('records in Solvantis only by default without calling Xero', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed' });

    const response = await POST(request() as any, { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockAddPayment).toHaveBeenCalledWith(42, expect.objectContaining({ xero_post_intent: 'solvantis_only' }), 'biz-1');
    expect(mockXeroSync).not.toHaveBeenCalled();
  });

  it('posts to Xero only when explicitly selected', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'confirmed' });

    const response = await POST(request({ xero_post_intent: 'post_to_xero' }) as any, { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockXeroSync).toHaveBeenCalledWith('biz-1', 42, 8);
  });

  it('blocks payments while a customer backorder is held', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'backordered' });

    const response = await POST(request() as any, { params: { id: '42' } });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Release this customer backorder');
    expect(mockAddPayment).not.toHaveBeenCalled();
    expect(mockXeroSync).not.toHaveBeenCalled();
  });
});
