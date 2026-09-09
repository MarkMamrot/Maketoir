import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), record: vi.fn(), sync: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/loyalty/LoyaltyService', () => ({ LoyaltyService: { recordTransaction: mocks.record } }));
vi.mock('@/lib/loyalty/ShopifyLoyaltyMetafieldService', () => ({
  ShopifyLoyaltyMetafieldService: { syncConfiguredCustomer: mocks.sync },
}));

import { LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/loyalty/adjustments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

const validBody = { contactId: 42, pointsDelta: 125, reason: 'Service recovery', idempotencyKey: 'ims:adjust:12345678' };

describe('POST /api/ims/loyalty/adjustments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', userId: 8, tier: 'Admin' });
    mocks.record.mockResolvedValue({ transactionId: 9, accountId: 3, balanceAfter: 325, duplicate: false });
    mocks.sync.mockResolvedValue({ status: 'synced', contactId: 42, shopifyCustomerId: '123', balancePoints: 325 });
  });

  it('requires an Admin or SuperAdmin', async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await POST(request(validBody))).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ businessId: 'business-1', userId: 7, tier: 'StandardUser' });
    expect((await POST(request(validBody))).status).toBe(403);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('requires whole points, a reason, and a valid request key', async () => {
    expect((await POST(request({ ...validBody, pointsDelta: 1.5 }))).status).toBe(400);
    expect((await POST(request({ ...validBody, reason: ' ' }))).status).toBe(400);
    expect((await POST(request({ ...validBody, idempotencyKey: 'short' }))).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('records a tenant-scoped audited adjustment and refreshes Shopify', async () => {
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith({
      businessId: 'business-1', contactId: 42, type: 'adjustment', pointsDelta: 125,
      channel: 'manual', sourceType: 'ims_manual_adjustment', sourceId: 'ims:adjust:12345678',
      idempotencyKey: 'ims:adjust:12345678', actorId: 8, reason: 'Service recovery',
    });
    expect(mocks.sync).toHaveBeenCalledWith({ businessId: 'business-1', contactId: 42 });
    expect(await response.json()).toMatchObject({ success: true, adjustment: { balanceAfter: 325 } });
  });

  it('does not sync Shopify when the ledger rejects the adjustment', async () => {
    mocks.record.mockRejectedValueOnce(new LoyaltyValidationError('The customer does not have enough points.'));
    const response = await POST(request({ ...validBody, pointsDelta: -500 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'The customer does not have enough points.' });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('returns a warning without reversing a committed adjustment when Shopify sync fails', async () => {
    mocks.sync.mockResolvedValueOnce({ status: 'failed', contactId: 42, error: 'Shopify unavailable' });
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, warning: 'Points were adjusted, but Shopify could not be updated.' });
  });
});