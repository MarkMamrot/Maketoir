import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/ims/businessOperations', () => ({ assertXeroAccountingEnabled: vi.fn() }));
import { GET } from '../route';

describe('Xero queued purchase eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.query.mockResolvedValue([]);
  });

  it('excludes consignment purchasing at both queue source queries without filtering sales or customer refunds', async () => {
    expect(await (await GET()).json()).toEqual({ queued: [], count: 0 });
    const sqls = mocks.query.mock.calls.map(call => String(call[0]));
    expect(sqls.find(sql => sql.includes('FROM ims_purchase_orders'))).toContain('po.consignment_supplier_id IS NULL');
    expect(sqls.find(sql => sql.includes('FROM ims_supplier_credit_notes'))).toContain('scn.consignment_supplier_id IS NULL');
    expect(sqls.find(sql => sql.includes('FROM ims_sales_orders'))).not.toContain('consignment');
    expect(sqls.find(sql => sql.includes('FROM ims_credit_notes'))).not.toContain('consignment');
    expect(sqls.every(sql => !sql.includes('is_consignment_supplier'))).toBe(true);
    expect(mocks.query.mock.calls.every(call => call[1][0] === 'biz-1')).toBe(true);
  });
});
