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

const codes = ['FC-AJ02', 'FC-LL1207', 'GS-LL30', 'MT-LL53', 'HP-LL05', 'QP-LL01', 'QP-LL03'];
const variants = codes.map((sku, index) => ({ variant_id: `variant-${index}`, sku, product_name: sku }));
const invoice = { supplier_name: 'Supplier', matched_supplier_id: 9, prices_include_tax: 'ex_tax', line_items: codes.map(product_code => ({ product_code, product_name: product_code, qty: 1, unit_price: 10, line_total: 10 })) };
function request(poId?: number) {
  const form = new FormData();
  form.set('file', new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' }));
  if (poId) form.set('poId', String(poId));
  return new Request('http://localhost/parse', { method: 'POST', body: form });
}
describe('invoice parsing product lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('GEMINI_API_KEY', 'test');
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.run.mockImplementation((_businessId, callback) => callback());
    mocks.generate.mockResolvedValue({ text: JSON.stringify(invoice) });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_contacts')) return [{ id: 9, name: 'Supplier' }];
      if (sql.includes('FROM ims_product_variants')) return variants;
      if (sql.includes('FROM ims_purchase_order_items')) return [{ id: 1, variant_id: 'variant-0', qty_ordered: 1, qty_received: 0, unit_cost: 10, sku: codes[0] }];
      return [];
    });
  });
  it('matches the seven reported codes without a supplier restriction or catalogue cap', async () => {
    const response = await POST(request());
    const body = await response.json();
    expect(body.line_results).toHaveLength(7);
    expect(body.line_results.every((line: any) => line.match?.confidence === 'exact_sku')).toBe(true);
    const lookup = mocks.query.mock.calls.find(([sql]) => sql.includes('FROM ims_product_variants'));
    expect(lookup?.[0]).not.toContain('LIMIT 2000');
    expect(lookup?.[0]).not.toContain('supplier_contact_id =');
    expect(mocks.run).toHaveBeenCalledWith('biz-1', expect.any(Function));
  });
  it('keeps unmatched invoice lines visible in PO comparison', async () => {
    mocks.generate.mockResolvedValue({ text: JSON.stringify({ ...invoice, line_items: [...invoice.line_items, { product_code: 'UNKNOWN', product_name: 'Unknown item', qty: 1, unit_price: 10 }] }) });
    const body = await (await POST(request(1))).json();
    expect(body.po_comparison).toContainEqual(expect.objectContaining({ invoice_line: expect.objectContaining({ product_code: 'UNKNOWN' }), not_in_po: true, requires_review: true }));
  });
  it('flags duplicate invoice rows without prefilling only the first quantity', async () => {
    mocks.generate.mockResolvedValue({ text: JSON.stringify({ ...invoice, line_items: [invoice.line_items[0], { ...invoice.line_items[0], qty: 2, line_total: 20 }] }) });
    const body = await (await POST(request(1))).json();
    expect(body.po_comparison[0]).toMatchObject({ invoice_line: null, requires_review: true });
    expect(body.po_comparison.filter((row: any) => row.not_in_po)).toHaveLength(2);
  });
  it('requires supplier review even for exact codes and retains unknown cost context', async () => {
    const body = await (await POST(request(1))).json();
    expect(body.supplier_exact).toBe(true);
    expect(body.cost_currency_known).toBe(false);
    expect(body.po_comparison[0]).toMatchObject({ requires_review: true, review_reason: expect.stringContaining('Supplier') });
  });
  it('retains printed and discounted costs and allows an exact supplier/code match', async () => {
    mocks.generate.mockResolvedValue({ text: JSON.stringify({ ...invoice, currency: 'AUD', line_items: [{ ...invoice.line_items[0], unit_price: 20, line_total: 10 }] }) });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_contacts')) return [{ id: 9, name: 'Supplier' }];
      if (sql.includes('FROM ims_product_variants')) return [{ ...variants[0], supplier_contact_id: 9, cost_aud: 20 }];
      if (sql.includes('FROM ims_purchase_order_items')) return [{ id: 1, variant_id: 'variant-0', qty_ordered: 1, unit_cost: 20 }];
      return [];
    });
    const body = await (await POST(request(1))).json();
    expect(body.line_results[0].invoice_line).toMatchObject({ printed_unit_price: 20, line_total: 10 });
    expect(body.po_comparison[0].requires_review).toBe(false);
  });
});