import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), run: vi.fn(), query: vi.fn(), generate: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: vi.fn().mockResolvedValue(null) } }));
vi.mock('@/lib/ai/businessModelPreferences', () => ({ resolveBusinessAiModel: () => 'test-model' }));
vi.mock('@/lib/ai/billing/googleGateway', () => ({ createTrackedGoogleGenAI: () => ({ models: { generateContent: mocks.generate } }) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { POST } from '../route';

const variant = { variant_id: 'variant-1', sku: 'FC-AJ02', product_name: 'Fox shirt', supplier_contact_id: 9 };
const request = (lines: unknown[]) => new Request('http://localhost/match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supplier_id: 9, invoice_lines: lines }) });

describe('invoice matching endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('GEMINI_API_KEY', 'test');
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.run.mockImplementation((_businessId, callback) => callback());
    mocks.query.mockResolvedValueOnce([{ name: 'Supplier' }]).mockResolvedValueOnce([variant]);
    mocks.generate.mockResolvedValue({ text: '[]' });
  });
  it('resolves exact SKUs across supplier assignments without AI', async () => {
    mocks.query.mockReset().mockResolvedValueOnce([{ name: 'Supplier' }]).mockResolvedValueOnce([{ ...variant, supplier_contact_id: null }]);
    const response = await POST(request([{ index: 7, product_code: 'FC-AJ02' }]));
    expect(await response.json()).toMatchObject({ success: true, matches: [{ invoice_index: 7, variant_id: 'variant-1', match_confidence: 'exact_sku' }] });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledWith('biz-1', expect.any(Function));
  });
  it('batches a large invoice and retains every missing result', async () => {
    const response = await POST(request(Array.from({ length: 41 }, (_, index) => ({ index, product_name: 'Fox shirt' }))));
    const body = await response.json();
    expect(body.matches).toHaveLength(41);
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(body.matches.every((match: any) => match.variant_id === null)).toBe(true);
    expect(body.matches.map((match: any) => match.invoice_index)).toEqual(Array.from({ length: 41 }, (_, index) => index));
  });
  it('reports failed batches and keeps their rows available for review', async () => {
    mocks.generate.mockRejectedValueOnce(new Error('Provider failure'));
    const response = await POST(request(Array.from({ length: 21 }, (_, index) => ({ index, product_name: 'Fox shirt' }))));
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.matches).toHaveLength(21);
    expect(body.warnings).toHaveLength(1);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', operation: 'match_invoice_batch' }));
  });
  it('rejects duplicate original row indexes before querying', async () => {
    expect((await POST(request([{ index: 1 }, { index: 1 }]))).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});