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

// Upload a binary buffer to the Gemini File API and wait until ACTIVE
async function uploadBinaryToGemini(
  ai: GoogleGenAI,
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<{ uri: string; name: string } | null> {
  try {
    const blob = new Blob([buffer], { type: mimeType });
    const uploaded = await ai.files.upload({ file: blob, config: { displayName: filename, mimeType } });
    const name: string = (uploaded as any).name ?? '';
    const initialUri: string = (uploaded as any).uri ?? '';

    if (!name) return initialUri ? { uri: initialUri, name: '' } : null;

    const MAX_POLLS = 20;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const info = await (ai.files as any).get(name);
        const state: string = info?.state ?? 'PROCESSING';
        const uri: string = info?.uri ?? '';
        if (state === 'ACTIVE' && uri) return { uri, name };
        if (state === 'FAILED') return null;
        if (uri && state !== 'PROCESSING' && state !== 'PENDING') return { uri, name };
      } catch { /* keep polling */ }
    }
    return null;
  } catch (e) {
    console.error('[parse-invoice] Gemini upload failed:', e);
    return null;
  }
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

  // Upload to Gemini File API
  const buffer = Buffer.from(await invoiceFile.arrayBuffer());
  const uploaded = await uploadBinaryToGemini(ai, buffer, invoiceFile.name, invoiceFile.type);
  if (!uploaded) {
    return NextResponse.json({ error: 'Failed to upload file to AI service. Please try again.' }, { status: 500 });
  }

  // Fetch suppliers
  const suppliers = await imsQuery<{ id: number; name: string }>(
    `SELECT id, name FROM ims_contacts WHERE (type = 'supplier' OR type = 'both') AND business_id = ? AND is_active = 1 ORDER BY name`,
    [biz],
  );

  const prompt = `You are an expert invoice parser. Analyse the attached supplier invoice document and extract all data precisely.

Return ONLY a valid JSON object — no markdown fences, no extra text:
{
  "supplier_name": "exact supplier name as printed on the invoice",
  "invoice_number": "invoice number string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "currency": "3-letter code e.g. AUD, USD, GBP — default AUD if not shown",
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
      "tax_rate": 0.0
    }
  ]
}

Notes:
- product_code = the supplier's code for the item (often labelled "Item Code", "Part No", "SKU", "Code", "Style" etc.)
- Extract ALL line items even if there are many
- If prices are inc-tax, estimate the ex-tax unit_price and set appropriate tax_rate (e.g. 0.1 for 10% GST)
- For tax_rate: use 0.1 for Australian GST, 0 for GST-free

IMS Supplier list — set matched_supplier_id to the numeric id of the best match, or null:
${JSON.stringify(suppliers.map(s => ({ id: s.id, name: s.name })))}`;

  let parsedInvoice: any = null;
  try {
    const result = await ai.models.generateContent({
      model: modelId,
      contents: [{
        parts: [
          { fileData: { mimeType: invoiceFile.type, fileUri: uploaded.uri } },
          { text: prompt },
        ],
      }],
      config: { responseMimeType: 'application/json' },
    });
    const raw = (result.text ?? '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsedInvoice = JSON.parse(raw);
  } catch (e) {
    console.error('[parse-invoice] AI error:', e);
    // Best-effort cleanup
    if (uploaded.name) {
      try { await (ai.files as any).delete(uploaded.name); } catch {}
    }
    return NextResponse.json({ error: 'AI failed to parse the invoice. Try a clearer scan or different file.' }, { status: 500 });
  }

  // Best-effort cleanup of Gemini file (privacy)
  if (uploaded.name) {
    try { await (ai.files as any).delete(uploaded.name); } catch {}
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
      supplier_name:  parsedInvoice.supplier_name  ?? null,
      invoice_number: parsedInvoice.invoice_number ?? null,
      invoice_date:   parsedInvoice.invoice_date   ?? null,
      due_date:       parsedInvoice.due_date        ?? null,
      currency:       parsedInvoice.currency        ?? 'AUD',
      subtotal:       parsedInvoice.subtotal        ?? null,
      tax_total:      parsedInvoice.tax_total       ?? null,
      total_amount:   parsedInvoice.total_amount    ?? null,
      payment_terms:  parsedInvoice.payment_terms   ?? null,
    },
    matched_supplier: matchedSupplier,
    line_results:     lineResults,
    po_comparison:    poComparison,
  });
}
