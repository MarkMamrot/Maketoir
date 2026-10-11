import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { createTrackedGoogleGenAI } from '@/lib/ai/billing/googleGateway';
import { imsQuery } from '@/services/IMSMySQLService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { resolveBusinessAiModel } from '@/lib/ai/businessModelPreferences';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assessInvoiceMatchEvidence, createInvoiceVariantMatcher, selectInvoiceMatchCandidates, validateInvoiceAiMatches, type InvoiceMatchVariant } from '@/lib/ims/invoiceProductMatching';

export const runtime = 'nodejs';
export const maxDuration = 300;


export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const biz: string = session.businessId ?? '';

  let invoice_lines: any[];
  let supplier_id: number;
  let costContext: { currency: string | null; taxTreatment: string | null } = { currency: null, taxTreatment: null };
  try {
    const body = await req.json();
    invoice_lines = body.invoice_lines;
    supplier_id   = Number(body.supplier_id);
    costContext = { currency: typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : null, taxTreatment: ['inc_tax', 'ex_tax', 'no_tax'].includes(body.tax_treatment) ? body.tax_treatment : null };
    if (!Array.isArray(invoice_lines) || !Number.isSafeInteger(supplier_id) || supplier_id <= 0) {
      return NextResponse.json({ error: 'invoice_lines array and supplier_id are required.' }, { status: 400 });
    }
    if (invoice_lines.length > 1000) return NextResponse.json({ error: 'Match up to 1000 invoice lines at once.' }, { status: 400 });
    invoice_lines = invoice_lines.map((line, index) => ({
      index: line?.index ?? index,
      product_code: typeof line?.product_code === 'string' ? line.product_code.slice(0, 255) : null,
      barcode: typeof line?.barcode === 'string' ? line.barcode.slice(0, 255) : null,
      product_name: typeof line?.product_name === 'string' ? line.product_name.slice(0, 1000) : null,
      ...Object.fromEntries(['unit_price', 'qty', 'line_total', 'discount_pct', 'discount_amount', 'tax_rate'].map(field => [field, line?.[field] != null && Number.isFinite(Number(line[field])) ? Number(line[field]) : null])),
    }));
    if (invoice_lines.some(line => !Number.isSafeInteger(line.index) || line.index < 0) || new Set(invoice_lines.map(line => line.index)).size !== invoice_lines.length) {
      return NextResponse.json({ error: 'Invoice row indexes must be unique non-negative integers.' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    return await runImsForBusiness(biz, async () => {
  const [supplier] = await imsQuery<{ name: string }>(
    `SELECT name FROM ims_contacts WHERE id = ? AND business_id = ?`,
    [supplier_id, biz],
  );
  if (!supplier) return NextResponse.json({ error: 'Supplier not found.' }, { status: 404 });

  const variants = await imsQuery<InvoiceMatchVariant & { supplier_contact_id: number | null }>(
    `SELECT v.variant_id, v.sku, v.barcode, v.cost_aud, v.cost_foreign, p.name AS product_name, p.supplier_contact_id,
            CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id
    WHERE p.business_id = ? AND v.is_active = 1 AND p.is_active = 1
    ORDER BY v.variant_id`,
      [biz],
  );

  const matchVariant = createInvoiceVariantMatcher(variants);
  const supplierVariants = variants.filter(variant => Number(variant.supplier_contact_id) === supplier_id);
  const matches: Array<ReturnType<typeof validateInvoiceAiMatches>[number] & { match_confidence?: string }> = [];
  const pending: Array<any & { candidates: InvoiceMatchVariant[] }> = [];
  for (const line of invoice_lines) {
    const match = matchVariant(line);
    if (match && match.confidence !== 'fuzzy_name') {
      matches.push({ invoice_index: line.index, variant_id: match.variant_id, confidence: 'high', match_confidence: match.confidence, reason: match.method, variant: match });
    } else {
      pending.push({ ...line, candidates: selectInvoiceMatchCandidates(line, supplierVariants, 20, costContext) });
    }
  }
  if (!pending.length) return NextResponse.json({ success: true, matches });

  let modelId = resolveBusinessAiModel(null, 'catalogueMatching');
  try {
    const conn = await ConnectionsRepository.get(biz);
    modelId = resolveBusinessAiModel(conn, 'catalogueMatching');
  } catch { /* use default */ }

  const ai = createTrackedGoogleGenAI(apiKey, {
    businessId: biz,
    area: 'catalogue_matching',
    operation: 'match_supplier_invoice_lines',
    actorType: 'user',
    referenceType: 'supplier',
    referenceId: supplier_id,
  });

  const warnings: string[] = [];
  for (let offset = 0; offset < pending.length; offset += 20) {
    const batch = pending.slice(offset, offset + 20);
    const matchable = batch.filter(line => line.candidates.length > 0);
    matches.push(...validateInvoiceAiMatches([], batch.filter(line => !line.candidates.length)));
    if (!matchable.length) continue;
    try {
      const prompt = `Match invoice rows for supplier ${supplier.name} to their individually listed catalogue candidates.
Return a JSON array with exactly one entry for every supplied original index:
[{"invoice_index":0,"variant_id":"candidate-id-or-null","confidence":"high|medium|low|null","reason":"brief reason"}]
Never use a candidate from another row. Match size, colour, style and identifiers, not just the product family.
Exact SKU or barcode supports high confidence. A uniquely convincing description plus variant supports medium. Ambiguous, conflicting or weak evidence must use low or null with variant_id null. Never guess to fill missing rows.
Cost evidence compares stored Cost (never Average Cost) with both undiscounted and discounted tax-exclusive invoice unit costs in the same currency. Either cost within 5% supports identity evidence but cannot prove a match or override conflicting codes. Not comparable means do not use price evidence.
${JSON.stringify(matchable.map(line => ({ index: line.index, product_code: line.product_code, barcode: line.barcode, product_name: line.product_name, candidates: line.candidates.map((variant: InvoiceMatchVariant) => ({ variant_id: variant.variant_id, sku: variant.sku, barcode: variant.barcode, name: variant.product_name, variant: variant.variant_label, cost_evidence: assessInvoiceMatchEvidence({ confidence: 'ai_match', supplierExact: false, variant, line, ...costContext }) })) })))}`;
      const result = await ai.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      } as any);
      const raw = (result.text ?? '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      if (!raw) throw new Error('Empty response from AI');
      const parsed = JSON.parse(raw);
      matches.push(...validateInvoiceAiMatches(Array.isArray(parsed) ? parsed : parsed?.matches, matchable));
    } catch (error) {
      await reportRuntimeIssue({ businessId: biz, source: 'invoice-import', operation: 'match_invoice_batch', title: 'Invoice product matching batch failed', error, context: { rowCount: matchable.length, batchOffset: offset, modelId } });
      matches.push(...validateInvoiceAiMatches([], matchable));
      warnings.push('Some invoice rows could not be matched. Review them or retry AI matching.');
    }
  }
  return NextResponse.json({ success: true, matches: matches.sort((left, right) => left.invoice_index - right.invoice_index), warnings: [...new Set(warnings)] });
    });
  } catch (error) {
    await reportRuntimeIssue({ businessId: biz, source: 'invoice-import', operation: 'prepare_line_matching', title: 'Invoice product matching failed', error, context: { rowCount: invoice_lines.length } });
    return NextResponse.json({ error: 'Invoice product matching could not be completed.' }, { status: 500 });
  }
}
