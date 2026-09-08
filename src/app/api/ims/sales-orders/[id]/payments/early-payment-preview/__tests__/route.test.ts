import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockGet } = vi.hoisted(() => ({ mockSession: vi.fn(), mockGet: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { get: mockGet } }));

import { POST } from '../route';

describe('POST sales-order early-payment preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1' });
    mockGet.mockResolvedValue({ total_amount: 110 });
  });

  it('returns unavailable when the saved order has no discount snapshot', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ payment_date: '2026-09-11', amount: 110 }),
    }) as any, { params: { id: '42' } });
    const payload = await response.json();

    expect(mockGet).toHaveBeenCalledWith(42, 'biz-1');
    expect(payload.data).toEqual({ available: false, reason: 'no_early_payment_discount' });
  });
});