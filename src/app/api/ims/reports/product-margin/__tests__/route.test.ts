import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRow } from '@/lib/ims/cogsTraceability/domain';
import { ReportValidationError } from '@/lib/ims/cogsTraceability/request';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), tenant: vi.fn(), evidence: vi.fn(), project: vi.fn(), query: vi.fn(), issue: vi.fn(), timeZone: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.tenant }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/ims/cogsTraceability/repository', () => ({ loadEvidence: mocks.evidence }));
vi.mock('@/lib/ims/cogsTraceability/projection', () => ({ projectReport: mocks.project }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mocks.timeZone }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.issue }));
import { GET } from '../route';

let insideTenant = false;
beforeEach(() => {
  vi.resetAllMocks();
  insideTenant = false;
  mocks.session.mockResolvedValue({ businessId: 'business-1' });
  mocks.timeZone.mockResolvedValue('Australia/Sydney');
  mocks.tenant.mockImplementation(async (_businessId, callback) => {
    insideTenant = true;
    try { return await callback(); } finally { insideTenant = false; }
  });
  mocks.evidence.mockImplementation(async () => {
    expect(insideTenant).toBe(true);
    return { lines: [], movements: [], allocations: [] };
  });
  mocks.project.mockReturnValue([]);
  mocks.query.mockImplementation(async () => { expect(insideTenant).toBe(true); return []; });
  mocks.issue.mockResolvedValue(1);
});
const request = (params = '') => new Request(`http://localhost/api/ims/reports/product-margin?${params}`);

describe('historical Product Profitability API', () => {
  it('requires authentication before data access', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
  it('loads recorded sale-date evidence under the authorized tenant', async () => {
    const response = await GET(request('from=2026-10-01&to=2026-10-14'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.tenant).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.evidence).toHaveBeenCalledWith('business-1', expect.objectContaining({
      basis: 'sale', from: '2026-10-01', to: '2026-10-14', toExclusive: '2026-10-15',
    }));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE p.business_id = ?'), ['business-1']);
    expect(mocks.query.mock.calls[0][0]).not.toMatch(/cost_aud|price_rrp|is_active|sales_cache/);
    expect(await response.json()).toMatchObject({ success: true, data: [], total: 0, summary: { netSales: 0, gp: 0 } });
  });
  it('returns full-result totals independently of page slicing', async () => {
    mocks.project.mockReturnValue(Array.from({ length: 101 }, (_, index) => ({
      ...emptyRow(String(index)), variantId: `v${index}`, sku: `S${index}`,
      qty: 1, netSales: 100, cogs: 60, gp: 40,
    })));
    const body = await (await GET(request('page=2'))).json();
    expect(body.data).toHaveLength(1);
    expect(body).toMatchObject({ total: 101, summary: { rows: 101, netSales: 10100, cogs: 6060, gp: 4040 } });
  });
  it.each(['window=bad', 'window=0', 'from=2026-02-30', 'from=2026-10-20&to=2026-10-01',
    'page=0', 'pageSize=201', 'supplierId=bad'])('rejects invalid parameters %s', async params => {
    expect((await GET(request(params))).status).toBe(400);
    expect(mocks.evidence).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it('reports bounded-source validation without silently truncating', async () => {
    mocks.evidence.mockRejectedValue(new ReportValidationError('Narrow the date range; no figures have been truncated.'));
    const response = await GET(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining('no figures') });
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it.each(['evidence', 'query'] as const)('reports %s failures, not successful zero totals', async dependency => {
    mocks[dependency].mockRejectedValue(new Error('private database detail'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: expect.not.stringContaining('private database detail') });
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', source: 'ims-product-profitability', operation: 'load_report',
      reference: { type: 'business', id: 'business-1' },
    }));
  });
});
