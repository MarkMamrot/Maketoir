import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), update: vi.fn(), fetch: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsPaymentMethodsRepo: { update: mocks.update } }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mocks.fetch }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { PUT } from '../route';

describe('payment account mapping', () => {
  const accountId = 'f9b899b5-919c-442d-be2e-3a6de42d29fc';
  const request = (reference: string) => new NextRequest('http://localhost/api/ims/payment-methods', {
    method: 'PUT', body: JSON.stringify({ id: 2, xero_account_code: reference }),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.update.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(undefined);
  });
  it('saves the ID for a code-less active payment account', async () => {
    mocks.fetch.mockResolvedValue({ Accounts: [{ AccountID: accountId, Name: 'Wise', Status: 'ACTIVE', Type: 'BANK' }] });
    expect((await PUT(request(accountId))).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(2, 'biz-1', { xero_account_code: accountId });
  });
  it('preserves existing coded account references', async () => {
    mocks.fetch.mockResolvedValue({ Accounts: [{ AccountID: accountId, Code: '11110', Status: 'ACTIVE', Type: 'BANK' }] });
    expect((await PUT(request('11110'))).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(2, 'biz-1', { xero_account_code: '11110' });
  });
  it('rejects display labels instead of saving a false mapping', async () => {
    mocks.fetch.mockResolvedValue({ Accounts: [{ AccountID: accountId, Name: 'Wise', Status: 'ACTIVE', Type: 'BANK' }] });
    expect((await PUT(request('Wise ()'))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('reports operational save failures for the correct business', async () => {
    mocks.fetch.mockRejectedValue(new Error('Provider unavailable'));
    expect((await PUT(request(accountId))).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', operation: 'update_payment_method' }));
  });
});