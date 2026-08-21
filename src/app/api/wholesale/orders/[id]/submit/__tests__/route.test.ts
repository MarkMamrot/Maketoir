import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  validateWholesaleOrderItems: vi.fn(),
  createSO: vi.fn(),
  createNotification: vi.fn().mockResolvedValue(undefined),
  sendReceipt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/wholesale/wholesaleSession', () => ({
  requireActiveWholesaleSession: mocks.requireActiveWholesaleSession,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { create: mocks.createSO } }));
vi.mock('@/lib/ims/createNotification', () => ({ createNotification: mocks.createNotification }));
vi.mock('@/lib/wholesale/wholesaleOrderNotifications', () => ({ sendWholesaleOrderSubmittedReceipt: mocks.sendReceipt }));
vi.mock('@/lib/wholesale/wholesaleOrderItems', () => ({
  validateWholesaleOrderItems: mocks.validateWholesaleOrderItems,
  WholesaleItemValidationError: class WholesaleItemValidationError extends Error {},
}));
vi.mock('resend', () => ({ Resend: class Resend {} }));

import { POST } from '../route';

const session = {
  businessId: 'biz-1', contactId: 42, companyId: 50, locationId: 60, memberId: 70,
  memberRole: 'owner', imsDb: 'ims-1', email: 'buyer@example.com', name: 'Buyer', company: 'Example Co',
};
const previewSession = {
  ...session,
  preview: {
    actorUserId: 9, actorName: 'Admin User', actorEmail: 'admin@example.com',
    previewSessionId: 'preview-session-1', mode: 'ims_draft_test' as const,
    startedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:30:00.000Z',
  },
};
const currentYear = new Date().getFullYear();

describe('wholesale order submission ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({
      session,
      brandAccess: { mode: 'all', brands: null },
    });
  });

  it('returns not found when the draft does not match the current account tuple', async () => {
    mocks.imsQuery.mockResolvedValueOnce([]);

    expect((await POST(new Request('http://localhost'), { params: { id: '88' } })).status).toBe(404);
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual([88, 'biz-1', 42, 50, 60, 70]);
    expect(mocks.createSO).not.toHaveBeenCalled();
  });

  it('snapshots company, buying location and member on the created sales order', async () => {
    const order = { id: 88, status: 'draft', notes: null, subtotal: 25, total_amount: 25 };
    const item = {
      id: 5, variant_id: 'variant-1', product_id: 'product-1', product_name: 'Product',
      variant_label: null, sku: 'SKU-1', qty: 2, unit_price: 12.5, line_total: 25,
    };
    mocks.imsQuery
      .mockResolvedValueOnce([order])
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ variant_id: 'variant-1', available: 10, allow_indent_wholesale: 0 }])
      .mockResolvedValueOnce([
        { key: 'default_warehouse_location_id', value: '9' },
        { key: 'sales_tax_rate', value: '0.1' },
      ])
      .mockResolvedValueOnce([{
        payment_terms: '30 days', shipping_address: '12 Market St', shipping_address2: null,
        shipping_suburb: 'Newtown', shipping_city: 'Sydney', shipping_state: 'NSW',
        shipping_postcode: '2042', shipping_country: 'Australia',
      }])
      .mockResolvedValueOnce([{ so_number: 'SO-123' }]);
    mocks.validateWholesaleOrderItems.mockResolvedValueOnce([item]);
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
    mocks.createSO.mockResolvedValueOnce(123);

    expect((await POST(new Request('http://localhost'), { params: { id: '88' } })).status).toBe(200);
    expect(mocks.createSO.mock.calls[0][0]).toEqual(expect.objectContaining({
      customer_id: 42,
      wholesale_company_id: 50,
      wholesale_location_id: 60,
      wholesale_member_id: 70,
      delivery_address: '12 Market St',
      delivery_suburb: 'Newtown',
      delivery_city: 'Sydney',
      delivery_state: 'NSW',
      delivery_postcode: '2042',
      delivery_country: 'Australia',
      payment_terms: '30 days',
    }));
    expect(mocks.imsQuery.mock.calls[4][1]).toEqual([70, 'biz-1', 42, 50, 60]);
    expect(mocks.imsExecute.mock.calls.at(-1)?.[1]).toEqual([123, 88, 'biz-1', 50, 60, 70]);
  });

  it('fails closed when the assigned buying location is no longer active', async () => {
    const order = { id: 88, status: 'draft', notes: null, subtotal: 25, total_amount: 25 };
    const item = {
      id: 5, variant_id: 'variant-1', product_id: 'product-1', product_name: 'Product',
      variant_label: null, sku: 'SKU-1', qty: 2, unit_price: 12.5, line_total: 25,
    };
    mocks.imsQuery
      .mockResolvedValueOnce([order])
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ variant_id: 'variant-1', available: 10, allow_indent_wholesale: 0 }])
      .mockResolvedValueOnce([{ key: 'default_warehouse_location_id', value: '9' }])
      .mockResolvedValueOnce([]);
    mocks.validateWholesaleOrderItems.mockResolvedValueOnce([item]);
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });

    expect((await POST(new Request('http://localhost'), { params: { id: '88' } })).status).toBe(409);
    expect(mocks.createSO).not.toHaveBeenCalled();
  });

  it('creates an attributed test Draft and suppresses ordinary submission side effects', async () => {
    mocks.requireActiveWholesaleSession.mockResolvedValue({
      session: previewSession,
      brandAccess: { mode: 'all', brands: null },
    });
    const order = { id: 88, status: 'draft', notes: null };
    const item = {
      id: 5, variant_id: 'variant-1', product_id: 'product-1', product_name: 'Product',
      variant_label: null, sku: 'SKU-1', qty: 2, unit_price: 12.5, line_total: 25,
    };
    mocks.imsQuery
      .mockResolvedValueOnce([{ value: 'ims_draft_test' }])
      .mockResolvedValueOnce([order])
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ variant_id: 'variant-1', available: 10, allow_indent_wholesale: 0 }])
      .mockResolvedValueOnce([{ key: 'default_warehouse_location_id', value: '9' }, { key: 'sales_tax_rate', value: '0.1' }])
      .mockResolvedValueOnce([{ payment_terms: '30 days', shipping_address: '12 Market St' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ so_number: `TEST-SO-${currentYear}-88` }]);
    mocks.validateWholesaleOrderItems.mockResolvedValueOnce([item]);
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
    mocks.createSO.mockResolvedValueOnce(123);

    const response = await POST(new Request('http://localhost'), { params: { id: '88' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ success: true, so_id: 123, is_test: true }));
    expect(mocks.createSO.mock.calls[0][0]).toEqual(expect.objectContaining({
      so_number: `TEST-SO-${currentYear}-88`,
      status: 'draft',
      is_staff_preview_test: 1,
      staff_preview_session_id: 'preview-session-1',
      staff_preview_actor_user_id: 9,
      staff_preview_actor_name: 'Admin User',
    }));
    expect(mocks.imsExecute.mock.calls.at(-2)?.[0]).toContain("AND status = 'draft'  AND o.is_staff_preview_test = 1 AND o.staff_preview_session_id = ?");
    expect(mocks.imsExecute.mock.calls.at(-2)?.[1]).toEqual([123, 88, 'biz-1', 50, 60, 70, 'preview-session-1']);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(mocks.sendReceipt).not.toHaveBeenCalled();
  });

  it('replays an already submitted test Draft without creating or notifying again', async () => {
    mocks.requireActiveWholesaleSession.mockResolvedValue({
      session: previewSession,
      brandAccess: { mode: 'all', brands: null },
    });
    mocks.imsQuery
      .mockResolvedValueOnce([{ value: 'ims_draft_test' }])
      .mockResolvedValueOnce([{ id: 88, status: 'submitted', so_id: 123 }])
      .mockResolvedValueOnce([{ id: 123, so_number: `TEST-SO-${currentYear}-88` }]);

    const response = await POST(new Request('http://localhost'), { params: { id: '88' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, so_id: 123, so_number: `TEST-SO-${currentYear}-88`, is_test: true, replayed: true });
    expect(mocks.createSO).not.toHaveBeenCalled();
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(mocks.sendReceipt).not.toHaveBeenCalled();
  });
});