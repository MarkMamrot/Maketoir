import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { createTrackedGoogleGenAI } from '@/lib/ai/billing/googleGateway';
import { imsQuery } from '@/services/IMSMySQLService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { resolveBusinessAiModel } from '@/lib/ai/businessModelPreferences';
import { normalizeParsedInvoice } from '@/lib/ims/invoiceImportParser';
import { createInvoiceVariantMatcher, invoiceMatchNeedsReview, type InvoiceMatchVariant } from '@/lib/ims/invoiceProductMatching';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const runtime = 'nodejs';
export const maxDuration = 120;


function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickAllowedValue(rawValue: unknown, allowedValues: string[]): string | null {
  if (typeof rawValue !== 'string') return null;
  const value = rawValue.trim();
  if (!value) return null;
  const normalizedValue = normalize(value);
  const exact = allowedValues.find(v => normalize(v) === normalizedValue);
  if (exact) return exact;
  const contains = allowedValues.find(v => normalize(v).includes(normalizedValue) || normalizedValue.includes(normalize(v)));
  return contains ?? null;
}

function fuzzySupplierMatch(
  name: string,
  suppliers: { id: number; name: string }[],
): { id: number; name: string } | null {
  if (!name?.trim()) return null;
  const n = name.toLowerCase().trim();
  // Exact
  const exact = suppliers.find(s => s.name.toLowerCase() === n);
  if (exact) return exact;
  // Contains (either direction)
  const contains = suppliers.find(s =>
    s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase()),
  );
  if (contains) return contains;
  // Normalized
  const nNorm = normalize(name);
  return suppliers.find(s => {
    const sNorm = normalize(s.name);
    return sNorm.includes(nNorm) || nNorm.includes(sNorm);
  }) ?? null;
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const biz: string = session.businessId ?? '';
  try {
    return await runImsForBusiness(biz, async () => {

  // Parse multipart form
  let invoiceFile: File | null = null;
  let poId: string | null = null;
  try {
    const fd = await req.formData();
    invoiceFile = fd.get('file') as File | null;
    poId = (fd.get('poId') as string | null) ?? null;
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  if (!invoiceFile) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  if (!ALLOWED_TYPES.has(invoiceFile.type)) {
    return NextResponse.json({ error: 'Unsupported file type. Use PDF, JPEG, PNG, or WebP.' }, { status: 400 });
  }
  if (invoiceFile.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 20 MB).' }, { status: 400 });
  }

  // Get configured Gemini model
  let modelId = resolveBusinessAiModel(null, 'documentExtraction');
  try {
    const conn = await ConnectionsRepository.get(biz);
    modelId = resolveBusinessAiModel(conn, 'documentExtraction');
  } catch { /* use default */ }

  const ai = createTrackedGoogleGenAI(apiKey, {
    businessId: biz,
    area: 'document_extraction',
    operation: 'parse_supplier_invoice',
    actorType: 'user',
    referenceType: 'purchase_order',
    referenceId: poId,
  });

  // Read file as base64 for inline Gemini data (faster + more reliable than File API for invoices)
  const buffer = Buffer.from(await invoiceFile.arrayBuffer());
  const base64Data = buffer.toString('base64');

  // Fetch suppliers
  const suppliers = await imsQuery<{ id: number; name: string }>(
    `SELECT id, name FROM ims_contacts WHERE (type = 'supplier' OR type = 'both') AND business_id = ? AND is_active = 1 ORDER BY name`,
    [biz],
  );

  const allowedProductTypes = await imsQuery<{ product_type: string }>(
    `SELECT DISTINCT product_type
     FROM ims_products
     WHERE business_id = ? AND product_type IS NOT NULL AND product_type != '' AND is_active = 1
     ORDER BY product_type`,
    [biz],
  );
  const allowedBrands = await imsQuery<{ name: string }>(
    `SELECT name
     FROM ims_brands
     WHERE business_id = ? AND name IS NOT NULL AND name != ''
     ORDER BY name`,
    [biz],
  );

  const prompt = `You are an expert invoice parser. Analyse the attached supplier invoice document and extract all data precisely.

CRITICAL — determine the tax treatment of the line item prices FIRST:
Look for clues: column headers like "Price (incl. GST)", "Inc GST", "Price (ex GST)", "Ex Tax", footnotes like "All prices include GST", or cross-check: if the sum of line_total values equals the invoice subtotal (ex-tax figure) then prices are ex_tax; if it equals the total_amount (inc-tax figure) then prices are inc_tax.
Set "prices_include_tax" to exactly one of: "inc_tax" (line prices already include tax), "ex_tax" (line prices are before tax), "no_tax" (no tax applies).

Also look for any genuinely order-wide discount at the invoice header or footer (for example "Less order discount"). Set "discount_total" only for a discount that is NOT already allocated into the printed product line subtotals. A summary such as "Product Discount" that totals the per-line DISCOUNTS column must NOT be returned as discount_total, because each printed line_total already includes it.

Extract the NET delivery, shipping, postage, or freight charge after any shipping discount into "freight_total". For example, Shipping Subtotal $56.58 and Shipping Discount -$56.58 means freight_total is 0. If freight is printed as an invoice row, mark that row as "line_type": "freight"; all supplied stock products must use "line_type": "product". Never classify freight as a product.

Do not import products listed under headings such as "ITEMS ON BACKORDER", "BACKORDERED ITEMS", "TO FOLLOW", or "NOT SUPPLIED". If you return them for completeness, set "line_type": "backorder" so the system excludes them.

Use ONLY values from the business catalog for product_type and brand. If the invoice does not clearly indicate a known value, set those fields to null rather than inventing a new one.
Allowed product types: ${JSON.stringify(allowedProductTypes.map(r => r.product_type).filter(Boolean))}
Allowed brands: ${JSON.stringify(allowedBrands.map(r => r.name).filter(Boolean))}

Treat each product line_total as the source of truth. Preserve the printed pre-discount unit price in unit_price and extract a printed per-line dollar discount into discount_amount. Use discount_pct only when the invoice explicitly prints a percentage. Keep RRP in the rrp field when available. The system will retain a line discount only when the price, quantity, discount, and line total reconcile; otherwise it safely derives the effective unit cost from line_total.
Do NOT convert inc-tax prices to ex-tax. The system handles tax arithmetic using prices_include_tax.

Return ONLY a valid JSON object — no markdown fences, no extra text:
{
  "supplier_name": "exact supplier name as printed on the invoice",
  "invoice_number": "invoice number string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "currency": "3-letter code e.g. AUD, USD, GBP — default AUD if not shown",
  "prices_include_tax": "inc_tax",
  "subtotal": 0.00,
  "tax_total": 0.00,
  "total_amount": 0.00,
  "discount_total": 0.00,
  "freight_total": 0.00,
  "payment_terms": "payment terms text or null",
  "matched_supplier_id": null,
  "line_items": [
    {
      "line_type": "product",
      "product_code": "supplier's own product code/SKU/item code or null",
      "barcode": "barcode, EAN, UPC, or GTIN if visible on invoice or null",
      "product_name": "product name or description from invoice",
      "qty": 0,
      "unit_price": 0.00,
      "rrp": 0.00,
      "discount_amount": 0.00,
      "discount_pct": 0,
      "line_total": 0.00,
      "product_type": null,
      "brand": null,
      "tax_rate": 0.1
    }
  ]
}

Notes:
- product_code = the supplier's code for the item (often labelled "Item Code", "Part No", "SKU", "Code", "Style" etc.)
- Extract ALL supplied stock product line items even if there are many
- Read every page and preserve one row for each printed supplied product line, including repeated products. Never summarize or omit rows to shorten the response
- Preserve product codes exactly, including hyphens, letter case and leading zeroes. Do not guess unreadable identifiers; return null instead
- line_type = "product" for supplied items, "freight" for freight rows, or "backorder" for items not supplied on this invoice
- Freight/delivery/shipping/postage rows must use line_type "freight", not "product"
- line_total is the authoritative amount for each product. Preserve it exactly to two decimal places after line-level dollar or percentage discounts
- unit_price is the printed invoiced unit price before the line discount; do not replace it with line_total / qty
- discount_amount is the printed dollar amount for that individual product line, entered as a positive number; use 0 when no line discount amount is printed
- A DISCOUNTS column may contain a dollar amount, not a percentage. Put it in discount_amount and leave discount_pct as 0 unless a percentage is explicitly printed
- barcode = barcode/EAN/UPC/GTIN printed for that product; preserve leading zeroes and return it as a string
- rrp = recommended retail price, retail price, MSRP, or SRP if shown for that product; use null if not shown
- tax_rate: 0.1 for Australian GST, 0 for GST-free items (applies even when prices_include_tax is inc_tax)

IMS Supplier list — set matched_supplier_id to the numeric id of the best match, or null:
${JSON.stringify(suppliers.map(s => ({ id: s.id, name: s.name })))}`;

  let parsedInvoice: any = null;
  try {
    const result = await ai.models.generateContent({
      model: modelId,
      contents: [{
        role: 'user',
        parts: [
          // Inline base64 — works for PDF + images, no File API polling needed
          { inlineData: { mimeType: invoiceFile.type, data: base64Data } } as any,
          { text: prompt },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 32768 },
    } as any);
    const raw = (result.text ?? '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!raw) throw new Error('Empty response from AI');
    parsedInvoice = JSON.parse(raw);
  } catch (e: any) {
    const detail = e?.message ?? String(e);
    await reportRuntimeIssue({ businessId: biz, source: 'invoice-import', operation: 'extract_invoice', title: 'Supplier invoice extraction failed', error: e, context: { modelId }, reference: poId ? { type: 'purchase_order', id: poId } : undefined });
    const msg = detail.includes('RESOURCE_EXHAUSTED')
      ? 'AI quota exceeded — try again in a moment.'
      : detail.includes('INVALID_ARGUMENT') || detail.includes('400')
      ? `AI rejected the request: ${detail.slice(0, 120)}`
      : detail.includes('404') || detail.includes('not found')
      ? `Model "${modelId}" not found — update your AI model in Intel & Automation settings.`
      : `AI error: ${detail.slice(0, 200)}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const normalizedInvoice = normalizeParsedInvoice(parsedInvoice);

  // Resolve supplier
  let matchedSupplier: { id: number; name: string } | null = null;
  if (parsedInvoice.matched_supplier_id) {
    matchedSupplier = suppliers.find(s => s.id === Number(parsedInvoice.matched_supplier_id)) ?? null;
  }
  if (!matchedSupplier) {
    matchedSupplier = fuzzySupplierMatch(parsedInvoice.supplier_name ?? '', suppliers);
  }

  const variants = await imsQuery<InvoiceMatchVariant>(
            `SELECT v.variant_id, v.sku, v.barcode, v.cost_aud, v.cost_foreign,
              p.name AS product_name, p.brand AS product_brand,
              CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE p.business_id = ? AND v.is_active = 1 AND p.is_active = 1
       ORDER BY v.variant_id`,
      [biz],
    );
  const matchVariant = createInvoiceVariantMatcher(variants);

  // Match each invoice line to IMS variant
  const lineResults = normalizedInvoice.line_items.map((line: any) => ({
    invoice_line: {
      ...line,
      product_type: pickAllowedValue(line?.product_type, allowedProductTypes.map(r => r.product_type).filter(Boolean)) ?? null,
      brand: pickAllowedValue(line?.brand, allowedBrands.map(r => r.name).filter(Boolean)) ?? null,
    },
    match: matchVariant(line),
  }));

  // Pathway 2: compare against existing PO items
  let poComparison: any[] | null = null;
  if (poId) {
    const poItems = await imsQuery<any>(
      `SELECT poi.id, poi.variant_id, poi.qty_ordered, poi.qty_received, poi.unit_cost,
              v.sku, p.name AS product_name,
              CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label
       FROM ims_purchase_order_items poi
       JOIN ims_product_variants v ON v.variant_id = poi.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE poi.po_id = ?`,
      [Number(poId)],
    );

    const matchedVariantIds = new Set<string>();
    poComparison = poItems.map((poLine: any) => {
      const lineRes = lineResults.find((lr: any) => lr.match?.variant_id === poLine.variant_id);
      const matchingLines = lineResults.filter((lr: any) => lr.match?.variant_id === poLine.variant_id);
      const invLine = matchingLines.length === 1 ? lineRes?.invoice_line ?? null : null;
      if (lineRes?.match && matchingLines.length === 1) matchedVariantIds.add(poLine.variant_id);
      return {
        po_line: {
          id: poLine.id,
          variant_id: poLine.variant_id,
          qty_ordered: Number(poLine.qty_ordered),
          qty_received: Number(poLine.qty_received ?? 0),
          unit_cost: Number(poLine.unit_cost),
          sku: poLine.sku,
          product_name: poLine.product_name,
          variant_label: poLine.variant_label,
        },
        invoice_line: invLine,
        requires_review: !!lineRes && (invoiceMatchNeedsReview(lineRes.match?.confidence) || matchingLines.length > 1),
        review_reason: matchingLines.length > 1 ? 'Multiple invoice rows match this PO variant. Review their combined quantity in Receive.' : null,
        qty_diff:   invLine ? Number(invLine.qty)        - Number(poLine.qty_ordered) : null,
        price_diff: invLine ? Number(invLine.unit_price) - Number(poLine.unit_cost)   : null,
        not_in_po: false,
      };
    });

    // Lines on invoice not matched to any PO item
    for (const lr of lineResults) {
      if (!lr.match || !matchedVariantIds.has(lr.match.variant_id)) {
        poComparison.push({ po_line: null, invoice_line: lr.invoice_line, qty_diff: null, price_diff: null, not_in_po: true, requires_review: true });
      }
    }
  }

  return NextResponse.json({
    success: true,
    invoice: {
      supplier_name:      normalizedInvoice.supplier_name      ?? null,
      invoice_number:     normalizedInvoice.invoice_number     ?? null,
      invoice_date:       normalizedInvoice.invoice_date       ?? null,
      due_date:           normalizedInvoice.due_date           ?? null,
      currency:           normalizedInvoice.currency           ?? 'AUD',
      prices_include_tax: (['inc_tax','ex_tax','no_tax'].includes(normalizedInvoice.prices_include_tax) ? normalizedInvoice.prices_include_tax : 'ex_tax') as 'inc_tax' | 'ex_tax' | 'no_tax',
      subtotal:           normalizedInvoice.subtotal           ?? null,
      tax_total:          normalizedInvoice.tax_total          ?? null,
      total_amount:       normalizedInvoice.total_amount       ?? null,
      payment_terms:      normalizedInvoice.payment_terms      ?? null,
      discount_total:     normalizedInvoice.discount_total     ?? null,
      freight_total:      normalizedInvoice.freight_total      ?? null,
    },
    matched_supplier: matchedSupplier,
    line_results:     lineResults,
    po_comparison:    poComparison,
  });
    });
  } catch (error) {
    await reportRuntimeIssue({ businessId: biz, source: 'invoice-import', operation: 'prepare_invoice', title: 'Supplier invoice matching failed', error });
    return NextResponse.json({ error: 'Invoice matching could not be completed. Please try again.' }, { status: 500 });
  }
}
