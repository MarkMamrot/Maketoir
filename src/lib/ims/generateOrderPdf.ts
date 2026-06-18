/**
 * generateOrderPdf.ts
 * Server-side PDF generation for Purchase Orders and Tax Invoices using pdf-lib.
 * pdf-lib is a pure-JS library — no file I/O, no AFM fonts, webpack-safe.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface OrderPdfOptions {
  type: 'po' | 'so';
  order: any;
  businessName: string;
  logoBase64?: string;
  businessAddress?: string;
  businessAbn?: string;
  termsAndConditions?: string;
}

const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const MARGIN_L  = 50;
const MARGIN_R  = 50;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

const COL_GREY  = rgb(0.53, 0.53, 0.53);
const COL_DARK  = rgb(0.1,  0.1,  0.18);
const COL_LINE  = rgb(0.88, 0.88, 0.88);
const COL_HEAD  = rgb(0.957, 0.957, 0.973);
const COL_MINT  = rgb(0,    0.722, 0.6);
const COL_ALT   = rgb(0.98, 0.98, 0.98);

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(n: number | null | undefined): string {
  if (n == null) return '—';
  const v = Number(n);
  return v % 1 === 0 ? String(v) : v.toFixed(4).replace(/\.?0+$/, '');
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '0%';
  return `${(Number(n) * 100).toFixed(0)}%`;
}

function fmtDate(d: string | undefined): string {
  if (!d) return '—';
  return d.slice(0, 10);
}

function calcDueDatePdf(orderDate: string | undefined, terms: string | undefined): string {
  if (!terms) return '—';
  if (terms === 'COD') return 'Cash on Delivery';
  const days = parseInt(terms);
  if (!orderDate || isNaN(days)) return '—';
  const d = new Date(orderDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Convert pdfkit-style Y (distance from top) to pdf-lib Y (distance from bottom).
function py(yFromTop: number): number {
  return PAGE_H - yFromTop;
}

export async function generateOrderPdf(opts: OrderPdfOptions): Promise<Buffer> {
  const { type, order, businessName, logoBase64, businessAddress, businessAbn, termsAndConditions } = opts;
  const isPO = type === 'po';

  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItal = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // ── LOGO ──────────────────────────────────────────────────────────────
  let hasLogo = false;
  if (logoBase64) {
    try {
      const b64      = logoBase64.replace(/^data:image\/[a-z]+;base64,/i, '');
      const imgBytes = Buffer.from(b64, 'base64');
      let img: any = null;
      try { img = await pdfDoc.embedPng(imgBytes); } catch {
        try { img = await pdfDoc.embedJpg(imgBytes); } catch { img = null; }
      }
      if (img) {
        const dims = img.scaleToFit(120, 50);
        page.drawImage(img, { x: MARGIN_L, y: py(50 + dims.height), width: dims.width, height: dims.height });
        hasLogo = true;
      }
    } catch { /* skip invalid logo */ }
  }

  // ── TITLE (right-aligned) ────────────────────────────────────────────
  const docTitle  = isPO ? 'PURCHASE ORDER' : 'TAX INVOICE';
  const titleSize = 22;
  const titleW    = fontBold.widthOfTextAtSize(docTitle, titleSize);
  page.drawText(docTitle, {
    x: PAGE_W - MARGIN_R - titleW, y: py(50 + titleSize),
    size: titleSize, font: fontBold, color: COL_DARK,
  });

  const orderNum = isPO ? order.po_number : order.so_number;
  const numSize  = 11;
  const numW     = fontReg.widthOfTextAtSize(orderNum, numSize);
  page.drawText(orderNum, {
    x: PAGE_W - MARGIN_R - numW, y: py(82 + numSize),
    size: numSize, font: fontReg, color: COL_GREY,
  });

  // ── BUSINESS NAME / ADDRESS ──────────────────────────────────────────
  const bNameTopY = hasLogo ? 110 : 90;
  page.drawText(businessName, {
    x: MARGIN_L, y: py(bNameTopY + 13),
    size: 13, font: fontBold, color: COL_DARK,
  });
  let afterBiz = bNameTopY + 17;
  if (businessAddress) {
    page.drawText(businessAddress, {
      x: MARGIN_L, y: py(afterBiz + 10),
      size: 10, font: fontReg, color: COL_GREY,
    });
    afterBiz += 14;
  }
  if (businessAbn) {
    page.drawText(`ABN: ${businessAbn}`, {
      x: MARGIN_L, y: py(afterBiz + 10),
      size: 10, font: fontReg, color: COL_GREY,
    });
    afterBiz += 14;
  }

  // ── DIVIDER ──────────────────────────────────────────────────────────
  const divY = Math.max(afterBiz, 96) + 12;
  page.drawLine({
    start: { x: MARGIN_L, y: py(divY) },
    end:   { x: PAGE_W - MARGIN_R, y: py(divY) },
    thickness: 1, color: COL_LINE,
  });

  // ── INFO GRID ────────────────────────────────────────────────────────
  const gridY = divY + 16;
  const colW  = CONTENT_W / 3;

  const cells: [string, string[]][] = [
    [isPO ? 'Supplier' : 'Customer',
      [isPO ? (order.supplier_name || '—') : (order.customer_name || '—'),
       ...(isPO
         ? (order.supplier_email ? [order.supplier_email] : [])
         : (order.customer_email ? [order.customer_email] : []))]],
    ['Location',   [order.location_name || '—']],
    ['Status',     [(order.status || '').toUpperCase()]],
    ['Order Date', [fmtDate(order.order_date)]],
    ['Expected Date', [fmtDate(order.expected_date)]],
    [isPO ? 'Received Date' : 'Fulfilled Date',
      [isPO ? fmtDate(order.received_date) : fmtDate(order.fulfilled_date)]],
    ...(isPO
      ? [
          ['Supplier Invoice #', [order.supplier_invoice_number || '—']] as [string, string[]],
          ['Payment Terms',      [order.payment_terms || '—']] as [string, string[]],
          ['Due Date',           [calcDueDatePdf(order.order_date, order.payment_terms)]] as [string, string[]],
        ]
      : [
          ['Payment Terms', [order.payment_terms || '—']] as [string, string[]],
          ['Due Date',      [calcDueDatePdf(order.order_date, order.payment_terms)]] as [string, string[]],
          ['', ['']] as [string, string[]],
        ]
    ),
  ];

  for (let idx = 0; idx < cells.length; idx++) {
    const [label, values] = cells[idx];
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x   = MARGIN_L + col * colW;
    const y   = gridY + row * 44;

    page.drawText(label.toUpperCase(), { x, y: py(y + 8), size: 8, font: fontBold, color: COL_GREY });
    for (let vi = 0; vi < values.length; vi++) {
      page.drawText(values[vi], { x, y: py(y + 22 + vi * 12), size: 10, font: fontReg, color: COL_DARK });
    }
  }

  let tY = gridY + Math.ceil(cells.length / 3) * 44 + 14;

  // ── NOTES ────────────────────────────────────────────────────────────
  if (order.notes) {
    page.drawText(`Notes: ${order.notes}`, {
      x: MARGIN_L, y: py(tY + 10),
      size: 10, font: fontItal, color: COL_GREY, maxWidth: CONTENT_W,
    });
    tY += 22;
  }

  tY += 8;

  // ── LINE ITEMS TABLE ─────────────────────────────────────────────────
  const colDefs = isPO
    ? [
        { label: 'SKU',        w: 80,  right: false },
        { label: 'Product',    w: 140, right: false },
        { label: 'Variant',    w: 90,  right: false },
        { label: 'Qty Ord',    w: 50,  right: true  },
        { label: 'Qty Recv',   w: 55,  right: true  },
        { label: 'Unit Cost',  w: 65,  right: true  },
        { label: 'Tax',        w: 35,  right: true  },
        { label: 'Line Total', w: 75,  right: true  },
      ]
    : [
        { label: 'SKU',        w: 75,  right: false },
        { label: 'Product',    w: 130, right: false },
        { label: 'Variant',    w: 85,  right: false },
        { label: 'Qty',        w: 40,  right: true  },
        { label: 'Fulfilled',  w: 55,  right: true  },
        { label: 'Unit Price', w: 60,  right: true  },
        { label: 'Disc',       w: 35,  right: true  },
        { label: 'Tax',        w: 35,  right: true  },
        { label: 'Line Total', w: 75,  right: true  },
      ];

  const rawW   = colDefs.reduce((s, c) => s + c.w, 0);
  const scl    = CONTENT_W / rawW;
  const sCols  = colDefs.map(c => ({ ...c, w: c.w * scl }));
  const rowH   = 18;

  // Header background
  page.drawRectangle({ x: MARGIN_L, y: py(tY + rowH), width: CONTENT_W, height: rowH, color: COL_HEAD });

  // Header labels
  let cx = MARGIN_L;
  for (const c of sCols) {
    const tw = fontBold.widthOfTextAtSize(c.label, 8);
    page.drawText(c.label, {
      x: c.right ? cx + c.w - 3 - tw : cx + 3,
      y: py(tY + rowH - 5),
      size: 8, font: fontBold, color: COL_GREY,
    });
    cx += c.w;
  }

  // Item rows
  const items: any[] = order.items || [];
  let ry = tY + rowH;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (i % 2 === 1) {
      page.drawRectangle({ x: MARGIN_L, y: py(ry + rowH), width: CONTENT_W, height: rowH, color: COL_ALT });
    }

    const vals = isPO
      ? [item.sku || '—', item.product_name || '—', item.variant_label || 'Default',
         fmtQty(item.qty_ordered), fmtQty(item.qty_received), fmt(item.unit_cost),
         fmtPct(item.tax_rate), fmt(item.line_total)]
      : [item.sku || '—', item.product_name || '—', item.variant_label || 'Default',
         fmtQty(item.qty_ordered), fmtQty(item.qty_fulfilled), fmt(item.unit_price),
         fmtPct(item.discount_pct), fmtPct(item.tax_rate), fmt(item.line_total)];

    cx = MARGIN_L;
    for (let j = 0; j < sCols.length; j++) {
      const c = sCols[j];
      let text = vals[j];
      // Truncate to fit column
      while (text.length > 1 && fontReg.widthOfTextAtSize(text, 8.5) > c.w - 6) {
        text = text.slice(0, -2) + '\u2026';
        if (text === '\u2026') break;
      }
      const tw = fontReg.widthOfTextAtSize(text, 8.5);
      page.drawText(text, {
        x: c.right ? cx + c.w - 3 - tw : cx + 3,
        y: py(ry + rowH - 5),
        size: 8.5, font: fontReg, color: COL_DARK,
      });
      cx += c.w;
    }

    page.drawLine({
      start: { x: MARGIN_L, y: py(ry + rowH) },
      end:   { x: PAGE_W - MARGIN_R, y: py(ry + rowH) },
      thickness: 0.5, color: COL_LINE,
    });

    ry += rowH;

    if (ry > PAGE_H - 120) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      ry = 50;
    }
  }

  // ── TOTALS ───────────────────────────────────────────────────────────
  let totY     = ry + 16;
  const tLblX  = PAGE_W - MARGIN_R - 155;
  const tValX  = PAGE_W - MARGIN_R - 75;

  // Invoice total rows: Subtotal, Tax, Freight (+), Discount (−)
  // NOTE: landed costs are NOT part of the invoice total — shown separately below.
  const totalsRows: [string, string][] = [
    ['Subtotal', fmt(order.subtotal)],
    ['GST (Tax)', fmt(order.tax_amount)],
  ];
  if (Number(order.freight) > 0)  totalsRows.push(['Freight (+)',   `+${fmt(order.freight)}`]);
  if (Number(order.discount) > 0) totalsRows.push(['Discount (−)', `−${fmt(order.discount)}`]);

  for (const [label, value] of totalsRows) {
    const lw = fontReg.widthOfTextAtSize(label, 10);
    const vw = fontReg.widthOfTextAtSize(value, 10);
    page.drawText(label, { x: tLblX + 75 - lw, y: py(totY + 10), size: 10, font: fontReg, color: COL_GREY });
    page.drawText(value, { x: tValX + 75 - vw, y: py(totY + 10), size: 10, font: fontReg, color: COL_GREY });
    totY += 16;
  }

  page.drawRectangle({ x: tLblX - 8, y: py(totY + 22), width: 163, height: 22, color: COL_HEAD });
  const totalStr = fmt(order.total_amount);
  const tlw = fontBold.widthOfTextAtSize('TOTAL', 11);
  const tvw = fontBold.widthOfTextAtSize(totalStr, 11);
  page.drawText('TOTAL',   { x: tLblX + 75 - tlw, y: py(totY + 16), size: 11, font: fontBold, color: COL_DARK });
  page.drawText(totalStr,  { x: tValX + 75 - tvw, y: py(totY + 16), size: 11, font: fontBold, color: COL_MINT });

  // ── LANDED COSTS (below invoice total — not part of what you owe the supplier) ──
  const landedCostRows: any[] = order.landed_costs && order.landed_costs.length > 0
    ? order.landed_costs : [];
  if (landedCostRows.length > 0) {
    totY += 32;
    page.drawText('LANDED COSTS (separate invoices — added to product avg. cost, not to order total)',
      { x: MARGIN_L, y: py(totY + 9), size: 8, font: fontBold, color: COL_GREY });
    totY += 16;
    for (const lc of landedCostRows) {
      const lcLabel = lc.reference ? `${lc.label}  (Ref: ${lc.reference})` : lc.label;
      const lcAmt   = fmt(lc.amount);
      const lcLw    = fontReg.widthOfTextAtSize(lcLabel, 9);
      const lcVw    = fontReg.widthOfTextAtSize(lcAmt, 9);
      page.drawText(lcLabel, { x: MARGIN_L,            y: py(totY + 9), size: 9, font: fontReg, color: COL_GREY });
      page.drawText(lcAmt,   { x: PAGE_W - MARGIN_R - lcVw, y: py(totY + 9), size: 9, font: fontReg, color: COL_GREY });
      totY += 14;
    }
  }

  // ── TERMS & CONDITIONS ───────────────────────────────────────────────
  if (termsAndConditions?.trim()) {
    const tcY = totY + 42;
    page.drawLine({ start: { x: MARGIN_L, y: py(tcY) }, end: { x: PAGE_W - MARGIN_R, y: py(tcY) }, thickness: 0.5, color: COL_LINE });
    page.drawText('TERMS & CONDITIONS', { x: MARGIN_L, y: py(tcY + 17), size: 9, font: fontBold, color: COL_GREY });
    let tcLineY = tcY + 30;
    for (const line of termsAndConditions.trim().split('\n')) {
      page.drawText(line || ' ', {
        x: MARGIN_L, y: py(tcLineY + 8.5),
        size: 8.5, font: fontReg, color: COL_GREY, maxWidth: CONTENT_W,
      });
      tcLineY += 13;
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
