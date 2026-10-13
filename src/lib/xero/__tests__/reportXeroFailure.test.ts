import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ report: vi.fn(), notify: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/createNotification', () => ({ createNotification: mocks.notify }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));

import { getXeroConfigurationNotice, reportXeroFailure } from '../reportXeroFailure';

describe('Xero configuration failure routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notify.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(1);
    mocks.run.mockImplementation((_businessId, callback) => callback());
  });

  it.each([
    'You cannot save this transaction using an inventory account type',
    'Missing Xero account mappings: inventory_asset and stock_adjustment are required',
    'No sales_revenue account mapped',
    'Xero API GET /Invoices/invoice-1 failed (404): Not found',
  ])('routes recognised setup failure to the exact tenant: %s', async message => {
    await reportXeroFailure({ businessId: 'tenant-1', source: 'xero', operation: 'po_bill', title: 'Xero bill failed', error: new Error(message), reference: { type: 'purchase_order', id: 17 } });
    expect(mocks.run).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(mocks.notify).toHaveBeenCalledWith('tenant-1', 'xero_configuration', expect.any(String), expect.stringContaining('17'), expect.any(Object), 'warning');
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it.each(['Xero unavailable', 'Xero API GET /Invoices/invoice-1 failed (500)', 'A validation exception occurred', 'Payments do not balance'])('keeps unexpected failures in Runtime Issues: %s', async error => {
    expect(getXeroConfigurationNotice(error)).toBeNull();
    await reportXeroFailure({ businessId: 'tenant-1', source: 'xero', operation: 'po_bill', title: 'Xero bill failed', error });
    expect(mocks.report).toHaveBeenCalledOnce();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('reports notification persistence failures without losing tenant attribution', async () => {
    mocks.notify.mockRejectedValue(new Error('DB unavailable'));
    await reportXeroFailure({ businessId: 'tenant-1', source: 'xero', operation: 'po_bill', title: 'Xero bill failed', error: 'No sales_revenue account mapped' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-1', operation: 'persist_configuration_notification' }));
  });

  it('does not put provider payloads or caller context in notifications', async () => {
    await reportXeroFailure({ businessId: 'tenant-1', source: 'xero', operation: 'po_bill', title: 'Xero bill failed', error: 'You cannot save this transaction using an inventory account type SECRET', context: { token: 'SECRET' } });
    expect(JSON.stringify(mocks.notify.mock.calls)).not.toContain('SECRET');
  });
});