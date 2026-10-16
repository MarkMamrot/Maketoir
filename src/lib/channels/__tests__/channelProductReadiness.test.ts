import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: query }));
import { channelPublicationIssues, getChannelProductReadiness } from '../channelProductReadiness';

const product = { product_id: 'p1', name: 'Chain', website_title: null, description: '<p>Gold chain.</p>', is_active: 1 };
const variant = { product_id: 'p1', sku: 'CHAIN-1', price_rrp: '49.95', is_active: 1 };

describe('online publication required fields', () => {
  beforeEach(() => vi.resetAllMocks());

  it('accepts a complete product without altering its tax-inclusive RRP', () => {
    expect(channelPublicationIssues(product, [variant])).toEqual([]);
    expect(variant.price_rrp).toBe('49.95');
  });

  it('requires title, description, SKU and RRP together', () => {
    expect(channelPublicationIssues({ ...product, name: ' ', description: ' ' }, [{ ...variant, sku: null, price_rrp: null }]))
      .toEqual(['Title is required.', 'Description is required.', 'Variant 1: SKU is required.', 'Variant 1: RRP must be greater than zero.']);
  });

  it.each(['', ' ', '<p><br></p>', '<p>&nbsp;&#160;&#xA0;</p>', '<!-- description -->', '<script>text</script>'])('rejects empty rich text: %s', description => {
    expect(channelPublicationIssues({ ...product, description }, [variant])).toContain('Description is required.');
  });

  it.each([null, '0', '-1', 'bad', 'Infinity'])('rejects missing or invalid RRP: %s', price_rrp => {
    expect(channelPublicationIssues(product, [{ ...variant, price_rrp }])).toContain('CHAIN-1: RRP must be greater than zero.');
  });

  it('validates every active variant, ignoring inactive variants', () => {
    expect(channelPublicationIssues(product, [variant, { ...variant, is_active: 0, sku: null, price_rrp: null }])).toEqual([]);
    expect(channelPublicationIssues(product, [variant, { ...variant, sku: ' ', price_rrp: 0 }])).toHaveLength(2);
  });

  it('accepts a website title or falls back to the product name', () => {
    expect(channelPublicationIssues({ ...product, name: '', website_title: 'Online title' }, [variant])).toEqual([]);
    expect(channelPublicationIssues({ ...product, website_title: ' ' }, [variant])).toEqual([]);
  });

  it('requires an existing active product and at least one active variant', () => {
    expect(channelPublicationIssues(undefined, [])).toEqual(['Product not found.']);
    expect(channelPublicationIssues({ ...product, is_active: 0 }, [])).toEqual(['Product must be active.', 'At least one active variant is required.']);
  });

  it('scopes both product and variant reads to the exact tenant and requested products', async () => {
    query.mockImplementation(async (sql: string) => sql.includes('ims_product_variants') ? [variant] : [product]);
    const result = await getChannelProductReadiness('tenant-1', ['p1', 'missing']);
    expect(result[0].issues).toEqual([]);
    expect(result[1].issues).toEqual(['Product not found.']);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain('business_id = ? AND product_id IN (?,?)');
      expect(params).toEqual(['tenant-1', 'p1', 'missing']);
    }
  });
});
