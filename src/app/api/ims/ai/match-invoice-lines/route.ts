import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { GoogleGenAI } from '@google/genai';
import { imsQuery } from '@/services/IMSMySQLService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';

export const runtime = 'nodejs';
export const maxDuration = 60;


export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const biz: string = session.businessId ?? '';

  let invoice_lines: any[];
  let supplier_id: number;
  try {
    const body = await req.json();
    invoice_lines = body.invoice_lines;
    supplier_id   = Number(body.supplier_id);
    if (!Array.isArray(invoice_lines) || !supplier_id) {
      return NextResponse.json({ error: 'invoice_lines array and supplier_id are required.' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // Fetch supplier name
  const [supplier] = await imsQuery<{ name: string }>(
    `SELECT name FROM ims_contacts WHERE id = ? AND business_id = ?`,
    [supplier_id, biz],
  );
  if (!supplier) return NextResponse.json({ error: 'Supplier not found.' }, { status: 404 });

  // Fetch all variants for this supplier
  const variants = await imsQuery<{
    variant_id: string; sku: string | null; barcode: string | null;
    product_name: string | null; variant_label: string | null;
  }>(
    `SELECT v.variant_id, v.sku, v.barcode, p.name AS product_name,
            CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id
     WHERE p.supplier_contact_id = ? AND p.business_id = ? AND v.is_active = 1 AND p.is_active = 1
     ORDER BY p.name`,
    [supplier_id, biz],
  );

  if (variants.length === 0) {
    return NextResponse.json({ error: 'No active products found for this supplier in IMS.' }, { status: 404 });
  }

  let modelId = 'gemini-2.5-flash-preview-04-17';
  try {
    const conn = await ConnectionsRepository.get(biz);
    if ((conn as any)?.gemini_model) modelId = (conn as any).gemini_model;
  } catch { /* use default */ }

  const ai = new GoogleGenAI({ apiKey });

  // Format variant list compactly for the prompt
  const variantList = variants.map(v => ({
    variant_id: v.variant_id,
    sku:        v.sku        ?? '',
    barcode:    v.barcode    ?? '',
    name:       [v.product_name, v.variant_label].filter(Boolean).join(' · '),
  }));

  // Only send lines that need matching (skip already-exact lines)
  const linesToMatch = invoice_lines.map((l, i) => ({ index: i, ...l }));

  const prompt = `You are a product matching specialist for a retail inventory system.

Match each invoice line item to the closest product in the IMS product catalogue below.

SUPPLIER: ${supplier.name}

INVOICE LINES TO MATCH (${linesToMatch.length} lines):
${JSON.stringify(linesToMatch, null, 2)}

IMS PRODUCT CATALOGUE FOR THIS SUPPLIER (${variantList.length} variants):
${JSON.stringify(variantList, null, 2)}

MATCHING RULES (in priority order):
1. If invoice product_code exactly matches an IMS sku → HIGH confidence
2. If invoice product_code matches an IMS barcode → HIGH confidence
3. If invoice product_code is contained within IMS sku or vice versa → MEDIUM
4. If invoice product name is very similar to IMS product name → MEDIUM
5. If partial name match or likely the same product with different description → LOW
6. No reasonable match → set variant_id to null

Return a JSON array with one entry per invoice line:
[
  {
    "invoice_index": 0,
    "variant_id": "the_matched_variant_id_or_null",
    "confidence": "high|medium|low|null",
    "reason": "brief explanation"
  }
]

Important: variant_id MUST be one of the variant_ids from the IMS catalogue above, or null. Do not invent variant_ids.`;

  let matches: { invoice_index: number; variant_id: string | null; confidence: string | null; reason: string }[];
  try {
    const result = await ai.models.generateContent({
      model: modelId,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    } as any);
    const raw = (result.text ?? '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!raw) throw new Error('Empty response from AI');
    const parsed = JSON.parse(raw);
    matches = Array.isArray(parsed) ? parsed : (parsed.matches ?? []);
  } catch (e: any) {
    const detail = e?.message ?? String(e);
    console.error('[match-invoice-lines] AI error:', detail);
    const msg = detail.includes('404') || detail.includes('not found')
      ? `Model "${modelId}" not found — update your AI model in Foresight settings.`
      : `AI matching failed: ${detail.slice(0, 150)}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Validate: ensure returned variant_ids exist in our catalogue
  const validIds = new Set(variants.map(v => v.variant_id));
  const safeMatches = matches.map(m => ({
    invoice_index: Number(m.invoice_index),
    variant_id:    m.variant_id && validIds.has(m.variant_id) ? m.variant_id : null,
    confidence:    m.confidence ?? null,
    reason:        m.reason ?? '',
  }));

  return NextResponse.json({ success: true, matches: safeMatches });
}
