import { describe, expect, it } from 'vitest';
import { buildBarcodeLabelBatchHtml, buildBarcodeLabelHtml, buildBarcodeSvgMarkup } from '../barcodeLabelPrinter';

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
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('preserveAspectRatio="xMinYMin meet"');
    expect(svg).toContain('style="display:block;width:100%;height:auto"');
    expect(svg).not.toContain('preserveAspectRatio="none"');
  });

  it('uses exact module coordinates with a full 10-module quiet zone on each side', () => {
    const svg = buildBarcodeSvgMarkup('ABC-123', 37, 8);
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    const bars = [...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)];

    expect(viewBox).not.toBeNull();
    expect(bars.length).toBeGreaterThan(0);
    expect(Number(bars[0][1])).toBe(10);
    expect(Number(bars.at(-1)?.[1]) + Number(bars.at(-1)?.[2])).toBe(Number(viewBox?.[1]) - 10);
    for (const [, x, width] of bars) {
      expect(Number.isInteger(Number(x))).toBe(true);
      expect(Number.isInteger(Number(width))).toBe(true);
    }
  });

  it('uses the standard Code 128 auto encoder for numeric and mixed values', () => {
    const numeric = buildBarcodeSvgMarkup('9346109020145', 37, 8);
    const mixed = buildBarcodeSvgMarkup('RC-C-SAS1331', 37, 8);

    expect(numeric).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(mixed).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(numeric).not.toBe(mixed);
  });

  it('returns an empty SVG string when the value cannot be encoded', () => {
    const svg = buildBarcodeSvgMarkup('\n\t', 37, 8);
    expect(svg).toBe('');
  });

  it('renders a mixed-product batch in item order and skips zero quantities', () => {
    const html = buildBarcodeLabelBatchHtml({
      size: { w: 40, h: 15, label: '40 × 15 mm' },
      items: [
        { productName: 'First Product', variant: { barcode: '111', sku: 'FIRST' }, qty: 2 },
        { productName: 'Skipped Product', variant: { barcode: '222' }, qty: 0 },
        { productName: 'Last Product', variant: { barcode: '333', sku: 'LAST' }, qty: 1 },
      ],
      showName: true,
      showBarcode: true,
      showBrand: false,
      showSku: true,
      priceMode: 'none',
    });

    expect(html.match(/class="label"/g)).toHaveLength(3);
    expect(html.match(/First Product/g)).toHaveLength(2);
    expect(html).not.toContain('Skipped Product');
    expect(html.indexOf('First Product')).toBeLessThan(html.indexOf('Last Product'));
  });
});
