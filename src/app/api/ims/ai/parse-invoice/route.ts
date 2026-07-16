import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { imsQuery } from '@/services/IMSMySQLService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';

export const runtime = 'nodejs';
export const maxDuration = 120;

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
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

type Variant = {
  variant_id: string;
  sku?: string | null;
  barcode?: string | null;
  cost_aud?: number | null;
  cost_foreign?: string | null;
  product_name?: string | null;
  variant_label?: string | null;
};

function matchVariant(
  productCode: string | null,
  barcode: string | null,
  productName: string | null,
  variants: Variant[],
): { variant_id: string; sku?: string | null; product_name?: string | null; variant_label?: string | null; cost_aud?: number | null; cost_foreign?: string | null; confidence: string; method: string } | null {
  const pc = productCode?.trim().toLowerCase();
  const bc = barcode?.trim().toLowerCase();

  // 1. exact SKU (IMS SKU is often the supplier code)
  if (pc) {
    const m = variants.find(v => v.sku?.toLowerCase() === pc);
    if (m) return { ...m, confidence: 'exact_sku', method: 'SKU' };
  }

  // 2. barcode match against product_code or barcode field
  const bcAlt = pc ?? bc;
  if (bcAlt) {
    const m = variants.find(v => v.barcode && (
      v.barcode.toLowerCase() === bcAlt || (bc && v.barcode.toLowerCase() === bc)
    ));
    if (m) return { ...m, confidence: 'exact_barcode', method: 'barcode' };
  }

  // 3. fuzzy product name
  if (productName?.trim()) {
    const normQ = normalize(productName);
    if (normQ.length >= 4) {
      const m = variants.find(v => {
        const full = normalize((v.product_name ?? '') + (v.variant_label ?? ''));
        return full.includes(normQ) || normQ.includes(full);
      });
      if (m) return { ...m, confidence: 'fuzzy_name', method: 'name' };
    }
  }

  return null;
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const biz: string = session.businessId ?? '';

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
  let modelId = 'gemini-2.5-flash-preview-04-17';
  try {
    const conn = await ConnectionsRepository.get(biz);
    if ((conn as any)?.gemini_model) modelId = (conn as any).gemini_model;
  } catch { /* use default */ }

  const ai = new GoogleGenAI({ apiKey });

  // Read file as base64 for inline Gemini data (faster + more reliable than File API for invoices)
  const buffer = Buffer.from(await invoiceFile.arrayBuffer());
  const base64Data = buffer.toString('base64');

  // Fetch suppliers
  const suppliers = await imsQuery<{ id: number; name: string }>(
    `SELECT id, name FROM ims_contacts WHERE (type = 'supplier' OR type = 'both') AND business_id = ? AND is_active = 1 ORDER BY name`,
    [biz],
  );

  const prompt = `You are an expert invoice parser. Analyse the attached supplier invoice document and extract all data precisely.

CRITICAL — determine the tax treatment of the line item prices FIRST:
Look for clues: column headers like "Price (incl. GST)", "Inc GST", "Price (ex GST)", "Ex Tax", footnotes like "All prices include GST", or cross-check: if the sum of line_total values equals the invoice subtotal (ex-tax figure) then prices are ex_tax; if it equals the total_amount (inc-tax figure) then prices are inc_tax.
Set "prices_include_tax" to exactly one of: "inc_tax" (line prices already include tax), "ex_tax" (line prices are before tax), "no_tax" (no tax applies).

Return unit_price and line_total EXACTLY as they appear on the invoice — do NOT convert inc-tax prices to ex-tax. The system handles the tax arithmetic using prices_include_tax.

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
  "payment_terms": "payment terms text or null",
  "matched_supplier_id": null,
  "line_items": [
    {
      "product_code": "supplier's own product code/SKU/item code or null",
      "barcode": "barcode if visible on invoice or null",
      "product_name": "product name or description from invoice",
      "qty": 0,
      "unit_price": 0.00,
      "discount_pct": 0,
      "line_total": 0.00,
      "tax_rate": 0.1
    }
  ]
}

Notes:
- product_code = the supplier's code for the item (often labelled "Item Code", "Part No", "SKU", "Code", "Style" etc.)
- Extract ALL line items even if there are many
- unit_price and line_total = values AS PRINTED on the invoice, never convert
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
      generationConfig: { responseMimeType: 'application/json' },
    } as any);
    const raw = (result.text ?? '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!raw) throw new Error('Empty response from AI');
    parsedInvoice = JSON.parse(raw);
  } catch (e: any) {
    const detail = e?.message ?? String(e);
    console.error('[parse-invoice] AI error:', detail);
    const msg = detail.includes('RESOURCE_EXHAUSTED')
      ? 'AI quota exceeded — try again in a moment.'
      : detail.includes('INVALID_ARGUMENT') || detail.includes('400')
      ? `AI rejected the request: ${detail.slice(0, 120)}`
      : detail.includes('404') || detail.includes('not found')
      ? `Model "${modelId}" not found — update your AI model in Foresight settings.`
      : `AI error: ${detail.slice(0, 200)}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Resolve supplier
  let matchedSupplier: { id: number; name: string } | null = null;
  if (parsedInvoice.matched_supplier_id) {
    matchedSupplier = suppliers.find(s => s.id === Number(parsedInvoice.matched_supplier_id)) ?? null;
  }
  if (!matchedSupplier) {
    matchedSupplier = fuzzySupplierMatch(parsedInvoice.supplier_name ?? '', suppliers);
  }

  // Fetch variants
  let variants: Variant[] = [];
  if (matchedSupplier) {
    variants = await imsQuery<Variant>(
      `SELECT v.variant_id, v.sku, v.barcode, v.cost_aud, v.cost_foreign,
              p.name AS product_name,
              CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE p.supplier_contact_id = ? AND p.business_id = ? AND v.is_active = 1 AND p.is_active = 1
       ORDER BY p.name`,
      [matchedSupplier.id, biz],
    );
  } else {
    // No supplier match — search all (capped to avoid huge payloads)
    variants = await imsQuery<Variant>(
      `SELECT v.variant_id, v.sku, v.barcode, v.cost_aud, v.cost_foreign,
              p.name AS product_name,
              CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE p.business_id = ? AND v.is_active = 1 AND p.is_active = 1
       ORDER BY p.name
       LIMIT 2000`,
      [biz],
    );
  }

  // Match each invoice line to IMS variant
  const lineResults = (parsedInvoice.line_items ?? []).map((line: any) => ({
    invoice_line: line,
    match: matchVariant(line.product_code ?? null, line.barcode ?? null, line.product_name ?? null, variants),
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
      const invLine = lineRes?.invoice_line ?? null;
      if (lineRes?.match) matchedVariantIds.add(poLine.variant_id);
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
        qty_diff:   invLine ? Number(invLine.qty)        - Number(poLine.qty_ordered) : null,
        price_diff: invLine ? Number(invLine.unit_price) - Number(poLine.unit_cost)   : null,
        not_in_po: false,
      };
    });

    // Lines on invoice not matched to any PO item
    for (const lr of lineResults) {
      if (lr.match && !matchedVariantIds.has(lr.match.variant_id)) {
        poComparison.push({ po_line: null, invoice_line: lr.invoice_line, qty_diff: null, price_diff: null, not_in_po: true });
      }
    }
  }

  return NextResponse.json({
    success: true,
    invoice: {
      supplier_name:      parsedInvoice.supplier_name      ?? null,
      invoice_number:     parsedInvoice.invoice_number     ?? null,
      invoice_date:       parsedInvoice.invoice_date       ?? null,
      due_date:           parsedInvoice.due_date           ?? null,
      currency:           parsedInvoice.currency           ?? 'AUD',
      prices_include_tax: (['inc_tax','ex_tax','no_tax'].includes(parsedInvoice.prices_include_tax) ? parsedInvoice.prices_include_tax : 'ex_tax') as 'inc_tax' | 'ex_tax' | 'no_tax',
      subtotal:           parsedInvoice.subtotal           ?? null,
      tax_total:          parsedInvoice.tax_total          ?? null,
      total_amount:       parsedInvoice.total_amount       ?? null,
      payment_terms:      parsedInvoice.payment_terms      ?? null,
    },
    matched_supplier: matchedSupplier,
    line_results:     lineResults,
    po_comparison:    poComparison,
  });
}
