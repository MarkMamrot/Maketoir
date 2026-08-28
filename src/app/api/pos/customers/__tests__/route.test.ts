import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), getSettings: vi.fn(), getProfile: vi.fn(), getPool: vi.fn(), getConnection: vi.fn(),
  execute: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  syncShopify: vi.fn(), syncMetafields: vi.fn(), report: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/loyalty/LoyaltyService', () => ({ LoyaltyService: { getSettings: mocks.getSettings } }));
vi.mock('@/lib/loyalty/LoyaltyPortalProfile', () => ({ LoyaltyPortalProfileRepository: { getByBusinessId: mocks.getProfile } }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.getPool }));
vi.mock('@/lib/ims/shopifyCustomerSync', () => ({ syncRetailCustomerToShopify: mocks.syncShopify }));
vi.mock('@/lib/loyalty/ShopifyLoyaltyMetafieldService', () => ({ ShopifyLoyaltyMetafieldService: { syncConfiguredCustomer: mocks.syncMetafields } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, POST } from '../route';

const request = (body: unknown) => new Request('http://localhost/api/pos/customers', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('/api/pos/customers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockReset();
    mocks.session.mockResolvedValue({ businessId: 'tenant-1' });
    mocks.getSettings.mockResolvedValue({ enabled: true, startedAt: null, programName: 'Threadheads' });
    mocks.getProfile.mockResolvedValue({ isActive: true, termsUrl: 'https://example.com/terms', termsVersion: '2', currentPolicyVersionId: 17 });
    mocks.getConnection.mockResolvedValue({ execute: mocks.execute, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release });
    mocks.getPool.mockReturnValue({ getConnection: mocks.getConnection });
    mocks.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ insertId: 42 }]).mockResolvedValue([{ affectedRows: 1 }]);
    mocks.syncShopify.mockResolvedValue({ success: false, action: 'skipped', reason: 'Shopify credentials not configured.' });
    mocks.syncMetafields.mockResolvedValue({ status: 'skipped' });
  });

  it('exposes active loyalty settings for the new-customer form', async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ loyalty: expect.objectContaining({ active: true, programName: 'Threadheads', termsUrl: 'https://example.com/terms' }) });
  });

  it('creates and links a tenant retail customer without loyalty by default', async () => {
    const response = await POST(request({ firstName: ' Ava ', lastName: 'Chen', email: 'AVA@example.com', phone: '' }));
    expect(response.status).toBe(201);
    expect(mocks.execute.mock.calls[1][0]).toContain('INSERT INTO ims_contacts');
    expect(mocks.execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['tenant-1', 'Ava Chen', 'ava@example.com', 0]));
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes('loyalty_membership_events'))).toBe(false);
    expect(mocks.commit).toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ customer: { id: 42, name: 'Ava Chen', email: 'ava@example.com' } });
  });

  it('records explicit POS loyalty consent in the same transaction', async () => {
    const response = await POST(request({ firstName: 'Ava', phone: '0412345678', loyaltyMember: true }));
    const eventCall = mocks.execute.mock.calls.find(([sql]) => String(sql).includes('loyalty_membership_events'));
    expect(response.status).toBe(201);
    expect(eventCall?.[1]).toEqual(['tenant-1', 42, '2', 17]);
    expect(mocks.commit.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder.at(-1)!);
  });

  it('refuses loyalty opt-in while the program is inactive', async () => {
    mocks.getSettings.mockResolvedValue({ enabled: false, startedAt: null, programName: 'Threadheads' });
    const response = await POST(request({ firstName: 'Ava', phone: '0412345678', loyaltyMember: true }));
    expect(response.status).toBe(409);
    expect(mocks.getPool).not.toHaveBeenCalled();
  });

  it('rejects a duplicate identifier without creating another customer', async () => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce([[{ id: 9, name: 'Existing', is_active: 0 }]]);
    const response = await POST(request({ firstName: 'Ava', email: 'ava@example.com' }));
    expect(response.status).toBe(409);
    expect(mocks.rollback).toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});