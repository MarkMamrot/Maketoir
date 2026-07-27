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

function fmtPrice(value: number | string | null | undefined): string {
  if (value == null || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return `$${num.toFixed(2)}`;
}

const CODE128_PATTERNS = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];

function isDigit(ch: string): boolean {
  const cc = ch.charCodeAt(0);
  return cc >= 48 && cc <= 57;
}

function digitRunLength(value: string, from: number): number {
  let i = from;
  while (i < value.length && isDigit(value[i])) i += 1;
  return i - from;
}

function toCodeB(ch: string): number {
  return ch.charCodeAt(0) - 32;
}

function encodeCode128Values(rawText: string): number[] {
  const text = String(rawText)
    .split('')
    .filter((ch) => {
      const cc = ch.charCodeAt(0);
      return cc >= 32 && cc <= 126;
    })
    .join('');
  if (!text) return [];

  const shouldStartC = (() => {
    const run = digitRunLength(text, 0);
    return run >= 4;
  })();

  const values: number[] = [shouldStartC ? 105 : 104];
  let mode: 'B' | 'C' = shouldStartC ? 'C' : 'B';
  let i = 0;

  while (i < text.length) {
    if (mode === 'C') {
      const run = digitRunLength(text, i);
      if (run >= 2) {
        if ((run % 2) === 1) {
          values.push(100); // Shift to Code B for one char to keep pairs aligned
          mode = 'B';
          continue;
        }
        while (i + 1 < text.length && isDigit(text[i]) && isDigit(text[i + 1])) {
          values.push(Number(text.slice(i, i + 2)));
          i += 2;
        }
        continue;
      }

      values.push(100); // Switch to Code B when no digit pair remains
      mode = 'B';
      continue;
    }

    const run = digitRunLength(text, i);
    if (run >= 4) {
      if ((run % 2) === 1) {
        values.push(toCodeB(text[i]));
        i += 1;
      }
      values.push(99); // Switch to Code C for a dense numeric run
      mode = 'C';
      continue;
    }

    values.push(toCodeB(text[i]));
    i += 1;
  }

  return values;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderCode128Svg(text: string, widthMm: number, heightMm: number): string {
  const values = encodeCode128Values(text);
  if (values.length === 0) return '';

  let check = values[0];
  for (let i = 1; i < values.length; i++) check += values[i] * i;
  const codes = [...values, check % 103, 106];

  const bars: Array<{ w: number; dark: boolean }> = [];
  let totalModules = 0;
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    let dark = true;
    for (let i = 0; i < pattern.length; i++) {
      const w = Number(pattern[i]);
      bars.push({ w, dark });
      totalModules += w;
      dark = !dark;
    }
  }

  const quietZoneMm = 2.5;
  const drawableMm = Math.max(1, widthMm - quietZoneMm * 2);
  const moduleMm = drawableMm / totalModules;
  const quietModules = Math.max(10, Math.ceil(quietZoneMm / moduleMm));
  const viewWidth = totalModules + quietModules * 2;
  const viewHeight = 100;

  let x = quietModules;
  let rects = '';
  for (const { w, dark } of bars) {
    if (dark) rects += `<rect x="${x}" y="0" width="${w}" height="${viewHeight}" fill="#000"/>`;
    x += w;
  }

  const safeLabel = escapeXml(String(text));
  return `<svg viewBox="0 0 ${viewWidth} ${viewHeight}" width="100%" height="100%" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Barcode ${safeLabel}" xmlns="http://www.w3.org/2000/svg"><rect width="${viewWidth}" height="${viewHeight}" fill="#fff"/>${rects}</svg>`;
}

export function buildBarcodeLabelHtml(options: BarcodeLabelRenderOptions): string {
  const { size, productName, brand, variant, qty, showName, showBarcode, showBrand, showSku, priceMode } = options;
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

  const barcodeSvg = showBarcode && variant?.barcode ? renderCode128Svg(String(variant.barcode), size.w - 2 * padH, bcH) : '';
  const singleLabel = `<div class="label">
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

  const labelsHtml = Array.from({ length: Math.max(1, qty) }).map(() => singleLabel).join('');

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
    .bc-wrap svg { display: block; width: 100%; height: 100%; }
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
