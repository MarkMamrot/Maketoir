import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockAdjustStoreCredit } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockAdjustStoreCredit: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsContactsRepo: { adjustStoreCredit: mockAdjustStoreCredit },
}));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/contacts/42/store-credit-adjustment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ims/contacts/[id]/store-credit-adjustment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'sage-business', tier: 'Owner' });
    mockAdjustStoreCredit.mockResolvedValue({ transactionId: 7, balanceBefore: 25, balanceAfter: 0 });
  });

  it('requires an authenticated writable IMS session', async () => {
    mockGetImsSession.mockResolvedValueOnce(null);
    expect((await POST(request({ amount: -25, reason: 'Entered in error' }), { params: { id: '42' } })).status).toBe(401);

    mockGetImsSession.mockResolvedValueOnce({ businessId: 'sage-business', tier: 'Advisor' });
    expect((await POST(request({ amount: -25, reason: 'Entered in error' }), { params: { id: '42' } })).status).toBe(403);
  });

  it('requires a non-zero amount and reason', async () => {
    expect((await POST(request({ amount: 0, reason: 'Correction' }), { params: { id: '42' } })).status).toBe(400);
    expect((await POST(request({ amount: -25, reason: ' ' }), { params: { id: '42' } })).status).toBe(400);
    expect(mockAdjustStoreCredit).not.toHaveBeenCalled();
  });

  it('forwards the session tenant and returns the adjusted balance', async () => {
    const response = await POST(request({ amount: -25, reason: 'Entered in error' }), { params: { id: '42' } });
    expect(response.status).toBe(200);
    expect(mockAdjustStoreCredit).toHaveBeenCalledWith(42, 'sage-business', -25, 'Entered in error');
    expect(await response.json()).toEqual({
      success: true,
      data: { transactionId: 7, balanceBefore: 25, balanceAfter: 0 },
    });
  });
});