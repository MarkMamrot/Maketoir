import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  validateWholesaleOrderItems: vi.fn(),
}));

vi.mock('@/lib/wholesale/wholesaleSession', () => ({
  requireActiveWholesaleSession: mocks.requireActiveWholesaleSession,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/wholesale/wholesaleOrderItems', () => ({
  validateWholesaleOrderItems: mocks.validateWholesaleOrderItems,
  WholesaleItemValidationError: class WholesaleItemValidationError extends Error {},
}));

import { GET, POST } from '../route';

const session = {
  businessId: 'biz-1', contactId: 42, companyId: 50, locationId: 60, memberId: 70,
  memberRole: 'owner', imsDb: 'ims-1', email: 'buyer@example.com', name: 'Buyer', company: 'Example Co',
};

describe('wholesale draft order ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({
      session,
      brandAccess: { mode: 'all', brands: null },
    });
  });

  it('lists drafts only for the current contact and account tuple', async () => {
    mocks.imsQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    expect((await GET()).status).toBe(200);
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('o.wholesale_company_id = ?');
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('o.wholesale_location_id = ?');
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('o.wholesale_member_id = ?');
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual(['biz-1', 42, 50, 60, 70]);
    expect(mocks.imsQuery.mock.calls[1][0]).toContain('FROM ims_sales_orders o');
    expect(mocks.imsQuery.mock.calls[1][0]).toContain('o.wholesale_company_id = ?');
    expect(mocks.imsQuery.mock.calls[1][0]).toContain('o.wholesale_location_id = ?');
    expect(mocks.imsQuery.mock.calls[1][0]).toContain('o.wholesale_member_id = ?');
    expect(mocks.imsQuery.mock.calls[1][1]).toEqual(['biz-1', 42, 50, 60, 70]);
  });

  it('snapshots the current account tuple when creating a draft', async () => {
    const item = {
      variant_id: 'variant-1', product_id: 'product-1', product_name: 'Product',
      variant_label: null, sku: 'SKU-1', qty: 2, unit_price: 12.5, is_indent: false, indent_qty: 0,
    };
    mocks.validateWholesaleOrderItems.mockResolvedValueOnce([item]);
    mocks.imsExecute.mockResolvedValueOnce({ insertId: 88 }).mockResolvedValueOnce({ affectedRows: 1 });
    const request = new Request('http://localhost/api/wholesale/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Test', items: [item] }),
    });

    expect((await POST(request)).status).toBe(200);
    expect(mocks.imsExecute.mock.calls[0][0]).toContain('wholesale_company_id, wholesale_location_id, wholesale_member_id');
    expect(mocks.imsExecute.mock.calls[0][1].slice(0, 5)).toEqual(['biz-1', 42, 50, 60, 70]);
  });
});