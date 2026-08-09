import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockRequireAdminSession,
  mockAssertBusinessAccess,
  mockExecute,
  mockQuery,
  mockXeroApiFetch,
} = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockXeroApiFetch: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));

vi.mock('@/services/MySQLService', () => ({
  execute: mockExecute,
  query: mockQuery,
}));

vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mockXeroApiFetch }));

import { GET, POST } from '../route';

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/xero/gateway-mappings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/xero/gateway-mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);
    mockXeroApiFetch.mockResolvedValue({ Accounts: [
      { AccountID: 'bank-91', Code: '091', Name: null, Status: 'ACTIVE', Type: 'BANK' },
      { AccountID: 'bank-92', Code: '092', Name: null, Status: 'ACTIVE', Type: 'BANK' },
      { AccountID: 'fee-404', Code: '404', Name: null, Status: 'ACTIVE', Type: 'EXPENSE' },
    ] });
  });

  it('returns fee tax treatment with each mapping', async () => {
    mockQuery.mockResolvedValueOnce([{ gateway_name: 'shopify_payments', fee_tax_type: 'INPUT' }]);

    const response = await GET(new NextRequest('http://localhost/api/xero/gateway-mappings?databaseId=biz-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mappings[0].fee_tax_type).toBe('INPUT');
    expect(mockQuery.mock.calls[0][0]).toContain('fee_tax_type');
  });

  it('persists a validated fee tax treatment', async () => {
    const response = await POST(postRequest({
      gateway_name: 'shopify_payments',
      display_name: 'Shopify Payments',
      clearing_account_code: '091',
      fee_account_code: '404',
      fee_tax_type: 'input',
    }) as any);

    expect(response.status).toBe(200);
    expect(mockExecute.mock.calls[0][1]).toEqual([
      'biz-1', 'shopify_payments', 'Shopify Payments', '091', null, '404', null, 'INPUT', 0, 0, 0,
    ]);
  });

  it('persists per-payment fee settings for a non-Shopify, non-PayPal gateway', async () => {
    const response = await POST(postRequest({
      gateway_name: 'afterpay',
      display_name: 'Afterpay',
      clearing_account_code: '092',
      fee_account_code: '404',
      fee_tax_type: 'NONE',
      deduct_fee_enabled: true,
      fixed_fee_amount: 0.3,
      percentage_fee_rate: 1,
    }) as any);

    expect(response.status).toBe(200);
    expect(mockExecute.mock.calls[0][1]).toEqual([
      'biz-1', 'afterpay', 'Afterpay', '092', null, '404', null, 'NONE', 1, 0.3, 1,
    ]);
  });

  it('forces PayPal fee deduction off', async () => {
    const response = await POST(postRequest({
      gateway_name: 'paypal',
      clearing_account_code: '092',
      fee_account_code: '404',
      deduct_fee_enabled: true,
      fixed_fee_amount: 0.3,
      percentage_fee_rate: 1,
    }) as any);

    expect(response.status).toBe(200);
    expect(mockExecute.mock.calls[0][1]).toEqual([
      'biz-1', 'paypal', 'paypal', '092', null, '404', null, null, 0, 0.3, 1,
    ]);
  });

  it('requires a fee account when fee deduction is enabled', async () => {
    const response = await POST(postRequest({
      gateway_name: 'afterpay',
      clearing_account_code: '092',
      deduct_fee_enabled: true,
      fixed_fee_amount: 0.3,
      percentage_fee_rate: 1,
    }) as any);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('fee_account_code');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects an archived clearing account before persistence', async () => {
    mockXeroApiFetch.mockResolvedValueOnce({ Accounts: [{ Code: '092', Status: 'ARCHIVED', Type: 'BANK' }] });
    const response = await POST(postRequest({ gateway_name: 'afterpay', clearing_account_code: '092' }) as any);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('active Xero account');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects unsupported fee tax treatments', async () => {
    const response = await POST(postRequest({
      gateway_name: 'shopify_payments',
      fee_tax_type: 'OUTPUT',
    }) as any);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('INPUT or NONE');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects cross-business reads before querying', async () => {
    mockAssertBusinessAccess.mockReturnValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }));

    const response = await GET(new NextRequest('http://localhost/api/xero/gateway-mappings?databaseId=other'));

    expect(response.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});