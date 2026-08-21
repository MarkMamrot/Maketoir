import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePosManagerTier: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  xeroApiFetch: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requirePosManagerTier: mocks.requirePosManagerTier }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mocks.xeroApiFetch }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

const context = { params: { depositId: '7' } };
const request = new Request('http://localhost/api/ims/money/cash-deposits/7/xero');

describe('GET /api/ims/money/cash-deposits/[depositId]/xero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePosManagerTier.mockReturnValue({
      user: { businessId: 'biz-1' },
      response: null,
    });
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.reportRuntimeIssue.mockResolvedValue(null);
  });

  it('redirects with the stored destination bank transaction ID', async () => {
    mocks.query.mockResolvedValue([{
      id: 7,
      xero_bank_transfer_id: 'transfer-1',
      xero_bank_transaction_id: 'destination-transaction-1',
    }]);

    const response = await GET(request, context);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://go.xero.com/Bank/ViewTransaction.aspx?bankTransactionID=destination-transaction-1');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('business_id = ? AND id = ?'), ['biz-1', 7]);
    expect(mocks.xeroApiFetch).not.toHaveBeenCalled();
  });

  it('resolves and stores the destination transaction ID for a historical deposit', async () => {
    mocks.query.mockResolvedValue([{
      id: 7,
      xero_bank_transfer_id: 'transfer-1',
      xero_bank_transaction_id: null,
    }]);
    mocks.xeroApiFetch.mockResolvedValue({
      BankTransfers: [{ BankTransferID: 'transfer-1', ToBankTransactionID: 'destination-transaction-1' }],
    });

    const response = await GET(request, context);

    expect(mocks.xeroApiFetch).toHaveBeenCalledWith('biz-1', '/BankTransfers/transfer-1');
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('xero_bank_transaction_id = ?'),
      ['destination-transaction-1', 'biz-1', 7],
    );
    expect(response.headers.get('location')).toContain('bankTransactionID=destination-transaction-1');
  });

  it('returns 404 for a deposit outside the authenticated business', async () => {
    mocks.query.mockResolvedValue([]);

    const response = await GET(request, context);

    expect(response.status).toBe(404);
    expect(mocks.xeroApiFetch).not.toHaveBeenCalled();
  });

  it('returns 409 when the deposit has not been transferred', async () => {
    mocks.query.mockResolvedValue([{
      id: 7,
      xero_bank_transfer_id: null,
      xero_bank_transaction_id: null,
    }]);

    const response = await GET(request, context);

    expect(response.status).toBe(409);
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('reports a historical Xero lookup failure', async () => {
    mocks.query.mockResolvedValue([{
      id: 7,
      xero_bank_transfer_id: 'transfer-1',
      xero_bank_transaction_id: null,
    }]);
    mocks.xeroApiFetch.mockRejectedValue(new Error('Xero unavailable'));

    const response = await GET(request, context);

    expect(response.status).toBe(502);
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      operation: 'open-xero-transfer',
      context: { depositId: 7 },
    }));
  });
});