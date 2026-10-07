import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRow } from '@/lib/ims/cogsTraceability/domain';

const mocks = vi.hoisted(() => ({ session: vi.fn(), scope: vi.fn(), report: vi.fn(), issue: vi.fn(), zone: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.scope }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mocks.zone }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.issue }));
vi.mock('@/lib/ims/cogsTraceability/service', () => ({ buildReport: mocks.report, reportColumns: (request: { columns: string[] }) => request.columns }));
import { GET } from '../route';
import { GET as exportReport } from '../export/route';

describe('traceability HTTP contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'tenant-1' });
    mocks.scope.mockImplementation((_id, callback) => callback());
    mocks.zone.mockResolvedValue('Australia/Sydney');
    mocks.issue.mockResolvedValue(1);
    mocks.report.mockResolvedValue({ success: true, rows: [], total: 0, exportRows: [] });
  });
  it.each([GET, exportReport])('requires authentication before any data read', async handler => {
    mocks.session.mockResolvedValue(null);
    expect((await handler(new Request('http://localhost/api/report'))).status).toBe(401);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('uses callback-form tenant context and keeps export data out of page payloads', async () => {
    const response = await GET(new Request('http://localhost/api/report?from=2026-10-01&to=2026-10-07'));
    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(mocks.report).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ from: '2026-10-01', toExclusive: '2026-10-08' }));
    expect(await response.json()).not.toHaveProperty('exportRows');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('rejects unsupported filter fields without a runtime issue', async () => {
    const response = await GET(new Request('http://localhost/api/report?sort=sql'));
    expect(response.status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it.each([GET, exportReport])('records operational errors without exposing database details', async handler => {
    mocks.report.mockRejectedValue(new Error('private database detail'));
    const response = await handler(new Request('http://localhost/api/report'));
    expect(response.status).toBe(500);
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-1', source: 'ims_cogs_traceability' }));
    expect(JSON.stringify(await response.json())).not.toContain('private database');
  });
  it('exports all filtered rows rather than just the selected page and escapes formulas', async () => {
    const first = Object.assign(emptyRow('1'), { orderRef: '=unsafe', netSales: 10 });
    const second = Object.assign(emptyRow('2'), { orderRef: 'SO2', netSales: 20 });
    mocks.report.mockResolvedValue({ rows: [first], exportRows: [first, second] });
    const response = await exportReport(new Request('http://localhost/api/report?columns=orderRef,netSales&pageSize=1'));
    const body = await response.text();
    expect(body).toContain("'=unsafe");
    expect(body).toContain('SO2');
    expect(body).toContain('Date basis');
    expect(response.headers.get('content-type')).toContain('text/csv');
  });
  it('keeps financial grouping values separate from summed CSV figures', async () => {
    const grouped = Object.assign(emptyRow('[50]'), { cogs: 100, netSales: 180, gp: 80 });
    mocks.report.mockResolvedValue({ exportRows: [grouped] });
    const response = await exportReport(new Request('http://localhost/api/report?from=2026-10-01&to=2026-10-07&groups=cogs&columns=cogs,netSales,gp'));
    const body = await response.text();
    expect(body).toContain('"COGS (AUD) (Group)","COGS (AUD)"');
    expect(body).toContain('"50","100","180","80"');
  });
});