export interface BarcodeLabelSize {
  label: string;
  w: number;
  h: number;
}

export interface BarcodeLabelVariant {
  barcode?: string | null;
  sku?: string | null;
  price_rrp?: number | string | null;
  price_rrp_sale?: number | string | null;
}

export interface BarcodeLabelRenderOptions {
  size: BarcodeLabelSize;
  productName?: string | null;
  brand?: string | null;
  variant?: BarcodeLabelVariant | null;
  qty: number;
  showName: boolean;
  showBarcode: boolean;
  showBrand: boolean;
  showSku: boolean;
  priceMode: 'none' | 'rrp' | 'sale';
}

export interface BarcodeLabelBatchItem {
  productName?: string | null;
  brand?: string | null;
  variant?: BarcodeLabelVariant | null;
  qty: number;
}

export interface BarcodeLabelBatchRenderOptions {
  size: BarcodeLabelSize;
  items: BarcodeLabelBatchItem[];
  showName: boolean;
  showBarcode: boolean;
  showBrand: boolean;
  showSku: boolean;
  priceMode: 'none' | 'rrp' | 'sale';
}

const CODE128_AUTO = require('jsbarcode/bin/barcodes/CODE128/CODE128_AUTO').default;

function fmtPrice(value: number | string | null | undefined): string {
  if (value == null || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return `$${num.toFixed(2)}`;
}

export function buildBarcodeSvgMarkup(text: string, widthMm: number, heightMm: number): string {
  const value = String(text);
  if (!value || /[^\x20-\x7E]/.test(value) || !(widthMm > 0) || !(heightMm > 0)) return '';

  // Use a maintained Code 128 implementation for set selection, checksum,
  // and stop pattern generation rather than maintaining a local encoder.
  const encoder = new CODE128_AUTO(value, {});
  if (!encoder.valid()) return '';
  const modules = String(encoder.encode().data);
  if (!/^[01]+$/.test(modules)) return '';

  const quietZoneModules = 10;
  const viewBoxWidth = modules.length + quietZoneModules * 2;
  // Preserve the requested physical ratio while making every horizontal
  // coordinate an exact Code 128 module. The SVG is rendered width-first;
  // a shorter label can clip height but must never distort bar widths.
  const viewBoxHeight = Math.max(1, Math.round(viewBoxWidth * heightMm / widthMm));
  let rects = '';
  for (let x = 0; x < modules.length;) {
    if (modules[x] === '0') { x += 1; continue; }
    const start = x;
    while (x < modules.length && modules[x] === '1') x += 1;
    rects += `<rect x="${quietZoneModules + start}" y="0" width="${x - start}" height="${viewBoxHeight}" fill="#000"/>`;
  }

  return `<svg viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" width="100%" preserveAspectRatio="xMinYMin meet" shape-rendering="crispEdges" style="display:block;width:100%;height:auto" xmlns="http://www.w3.org/2000/svg"><rect width="${viewBoxWidth}" height="${viewBoxHeight}" fill="white"/>${rects}</svg>`;
}

function buildSingleLabelMarkup(options: Omit<BarcodeLabelRenderOptions, 'qty'>): string {
  const { size, productName, brand, variant, showName, showBarcode, showBrand, showSku, priceMode } = options;
  const padV = 1.0;
  const padH = 1.5;
  const showTopRow = (showName && !!productName) || priceMode !== 'none';
  const showBottomRow = (showBrand && !!brand) || (showSku && !!variant?.sku);
  const topH = showTopRow ? size.h * 0.30 : 0;
  const botH = showBottomRow ? size.h * 0.23 : 0;
  const bcH = Math.max(4, size.h - 2 * padV - topH - botH);
  const namePt = Math.max(4, Math.round(topH * 2.835 * 0.50));
  const pricePt = Math.max(5, Math.round(topH * 2.835 * 0.80));
  const barcodePt = Math.max(8, Math.round(bcH * 2.835));
  const bottomPt = Math.max(4, Math.round(botH * 2.835 * 0.68));

  const name = showName ? (productName ?? '') : '';
  const brandText = showBrand ? (brand ?? '') : '';
  const sku = showSku ? (variant?.sku ?? '') : '';
  const rrp = fmtPrice(variant?.price_rrp);
  const sale = fmtPrice(variant?.price_rrp_sale);

  const priceSpan = (() => {
    if (priceMode === 'none') return '';
    if (priceMode === 'rrp') return rrp ? `<span class="price">${rrp}</span>` : '';
    if (sale) return `${rrp ? `<span class="rrp-strike">${rrp}</span>` : ''}<span class="price">${sale}</span>`;
    return rrp ? `<span class="price">${rrp}</span>` : '';
  })();

  const barcodeSvg = showBarcode && variant?.barcode ? buildBarcodeSvgMarkup(String(variant.barcode), size.w - 2 * padH, bcH) : '';
  return `<div class="label">
  ${showTopRow ? `<div class="top-row">
    <span class="pname">${name}</span>
    <span class="price-group">${priceSpan}</span>
  </div>` : ''}
  ${barcodeSvg ? `<div class="bc-wrap">${barcodeSvg}</div>` : ''}
  ${showBottomRow ? `<div class="bottom-row">
    ${brandText ? `<span class="brand">${brandText}</span>` : '<span></span>'}
    ${sku ? `<span class="sku">${sku}</span>` : ''}
  </div>` : ''}
</div>`;
}

export function buildBarcodeLabelBatchHtml(options: BarcodeLabelBatchRenderOptions): string {
  const { size, items, showName, showBarcode, showBrand, showSku, priceMode } = options;
  const padV = 1.0;
  const padH = 1.5;
  const topH = showName || priceMode !== 'none' ? size.h * 0.30 : 0;
  const botH = showBrand || showSku ? size.h * 0.23 : 0;
  const namePt = Math.max(4, Math.round(topH * 2.835 * 0.50));
  const pricePt = Math.max(5, Math.round(topH * 2.835 * 0.80));
  const bottomPt = Math.max(4, Math.round(botH * 2.835 * 0.68));

  const labelsHtml = items.flatMap(item => {
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    const label = buildSingleLabelMarkup({
      size,
      productName: item.productName,
      brand: item.brand,
      variant: item.variant,
      showName,
      showBarcode,
      showBrand,
      showSku,
      priceMode,
    });
    return Array.from({ length: qty }, () => label);
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: ${size.w}mm ${size.h}mm; margin: 0; }
    body { width: ${size.w}mm; font-family: Arial, Helvetica, sans-serif; }
    .label {
      width: ${size.w}mm; height: ${size.h}mm;
      display: flex; flex-direction: column;
      padding: ${padV}mm ${padH}mm;
      overflow: hidden; page-break-after: always;
    }
    .top-row {
      display: flex; align-items: baseline;
      justify-content: space-between; gap: 1mm;
      flex-shrink: 0; width: 100%; height: ${topH}mm;
    }
    .pname  { font-size: ${namePt}pt; font-weight: 700; flex: 1 1 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2; }
    .price-group { display: flex; align-items: baseline; gap: 1px; flex-shrink: 0; white-space: nowrap; }
    .price       { font-size: ${pricePt}pt; font-weight: 700; }
    .rrp-strike  { font-size: ${Math.max(4, pricePt - 2)}pt; text-decoration: line-through; color: #888; margin-right: 0.5mm; }
    .bc-wrap  { flex: 1 1 0; min-height: 0; display: flex; align-items: flex-start; width: 100%; overflow: hidden; }
    .bc-wrap svg { display: block; width: 100%; height: auto; }
    .bottom-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1mm; flex-shrink: 0; width: 100%; height: ${botH}mm; }
    .brand { font-size: ${bottomPt}pt; color: #555; flex: 1 1 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sku   { font-size: ${bottomPt}pt; color: #333; flex-shrink: 0; white-space: nowrap; letter-spacing: .3px; }
  </style>
</head>
<body onload="window.print(); window.close();">
  ${labelsHtml}
</body>
</html>`;
}

export function buildBarcodeLabelHtml(options: BarcodeLabelRenderOptions): string {
  const { productName, brand, variant, qty, ...batchOptions } = options;
  return buildBarcodeLabelBatchHtml({
    ...batchOptions,
    items: [{ productName, brand, variant, qty: Math.max(1, qty) }],
  });
}
