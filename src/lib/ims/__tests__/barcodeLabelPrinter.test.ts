import { describe, expect, it } from 'vitest';
import { buildBarcodeLabelHtml, buildBarcodeSvgMarkup } from '../barcodeLabelPrinter';

describe('buildBarcodeLabelHtml', () => {
  it('renders label content and includes a print trigger', () => {
    const html = buildBarcodeLabelHtml({
      size: { w: 40, h: 15, label: '40 × 15 mm' },
      productName: 'Test Product',
      brand: 'Acme',
      variant: { barcode: '1234567890', sku: 'SKU-1', price_rrp: 12.5, price_rrp_sale: 10 },
      qty: 2,
      showName: true,
      showBarcode: true,
      showBrand: true,
      showSku: true,
      priceMode: 'sale',
    });

    expect(html).toContain('Test Product');
    expect(html).toContain('SKU-1');
    expect(html).toContain('window.print()');
  });

  it('renders crisp SVG markup for printable barcode output', () => {
    const svg = buildBarcodeSvgMarkup('1234567890123', 37, 8);
    expect(svg).toContain('svg');
    expect(svg).toContain('rect');
  });

  it('returns an empty SVG string when the value cannot be encoded', () => {
    const svg = buildBarcodeSvgMarkup('\n\t', 37, 8);
    expect(svg).toBe('');
  });
});
