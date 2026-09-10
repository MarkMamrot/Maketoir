import { NextResponse } from 'next/server';

import { createTrackedGoogleGenAI } from '@/lib/ai/billing/googleGateway';
import { resolveBusinessAiModel } from '@/lib/ai/businessModelPreferences';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { normalizeBulkProductDocumentImport } from '@/lib/ims/bulkProductDocumentImport';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_PASTED_TEXT = 200_000;
const BINARY_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'text/tab-separated-values', 'application/csv']);
const TEXT_EXTENSIONS = /\.(txt|csv|tsv)$/i;

function aiErrorMessage(error: unknown, modelId: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes('RESOURCE_EXHAUSTED')) return 'AI quota exceeded - try again in a moment.';
  if (detail.includes('INVALID_ARGUMENT') || detail.includes('400')) return 'AI could not read that document. Try a clearer PDF, image, CSV, TSV, TXT, or pasted table.';
  if (detail.includes('404') || detail.toLowerCase().includes('not found')) return `Model "${modelId}" was not found. Update the Document Extraction model in Intel & Automation settings.`;
  return 'Product data could not be extracted from that document.';
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ success: false, error: 'Advisor accounts are read-only.' }, { status: 403 });

  const businessId = String(session.businessId ?? '');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: 'Document extraction is not configured.' }, { status: 503 });

  let file: File | null = null;
  let pastedText = '';
  try {
    const formData = await request.formData();
    const candidate = formData.get('file');
    file = candidate instanceof File && candidate.size > 0 ? candidate : null;
    pastedText = String(formData.get('text') ?? '').trim();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid upload data.' }, { status: 400 });
  }

  if (!file && !pastedText) return NextResponse.json({ success: false, error: 'Choose a document or paste product data.' }, { status: 400 });
  if (file && pastedText) return NextResponse.json({ success: false, error: 'Use either a document or pasted data for each import.' }, { status: 400 });
  if (pastedText.length > MAX_PASTED_TEXT) return NextResponse.json({ success: false, error: 'Pasted data is too large (maximum 200,000 characters).' }, { status: 400 });
  if (file && file.size > MAX_FILE_SIZE) return NextResponse.json({ success: false, error: 'File is too large (maximum 20 MB).' }, { status: 400 });

  const isTextFile = Boolean(file && (TEXT_TYPES.has(file.type) || TEXT_EXTENSIONS.test(file.name)));
  if (file && !BINARY_TYPES.has(file.type) && !isTextFile) {
    return NextResponse.json({ success: false, error: 'Unsupported file type. Use PDF, JPEG, PNG, WebP, CSV, TSV, or TXT.' }, { status: 400 });
  }

  let modelId = resolveBusinessAiModel(null, 'documentExtraction');
  try {
    modelId = resolveBusinessAiModel(await ConnectionsRepository.get(businessId), 'documentExtraction');
  } catch {
    // Use the document extraction default when optional connection preferences are unavailable.
  }

  try {
    const fileText = isTextFile && file ? await file.text() : '';
    if (fileText.length > MAX_PASTED_TEXT) return NextResponse.json({ success: false, error: 'Text file is too large (maximum 200,000 characters).' }, { status: 400 });
    const sourceText = pastedText || fileText;
    const prompt = `Extract product catalogue data from the supplied document or pasted table. Every visible supplied product line must become one object in products, including repeated lines. This is for creating new products; do not match anything to an existing catalogue.

Return ONLY valid JSON with this shape:
{
  "currency": "AUD, USD, EUR, GBP, THB, CNY, JPY, or UNKNOWN",
  "prices_include_tax": "inc_tax, ex_tax, no_tax, or unknown",
  "source_price_column": "the exact heading of a generic or ambiguous price column; blank if none",
  "supplier_name": "supplier legal or trading name printed in the invoice header; blank if absent",
  "products": [{
    "line_type": "product",
    "product_name": "name or product description",
    "product_code": "SKU, item code, style code, or supplier code; preserve leading zeroes; blank if absent",
    "barcode": "barcode, EAN, UPC, or GTIN; preserve leading zeroes; blank if absent",
    "description": "additional product description; blank if absent",
    "brand": "brand printed in the source; blank if absent",
    "supplier_name": "line-specific supplier only when different from the invoice supplier; otherwise blank",
    "product_type": "product type printed in the source; blank if absent",
    "category": "category printed in the source; blank if absent",
    "tags": ["tags explicitly present in the source"],
    "unit_cost": 0.00,
    "rrp": 0.00,
    "source_price": 0.00,
    "tax_rate": 0.1
  }]
}

Rules:
- Extract every actual product row, even when there are many.
- Do not include headings, subtotals, totals, freight, delivery, discounts, tax, payment, backorder-only, or blank rows.
- Never invent a name, SKU, barcode, brand, product type, category, tag, cost, RRP, currency, or tax treatment.
- Use null for missing numeric values and blank strings or empty arrays for missing text values.
- unit_cost is the printed per-unit buying cost before any line discount. rrp is the printed recommended retail price or MSRP.
- A generic heading such as Price, Unit Price, or Value is ambiguous unless the document clearly identifies it as buying cost or retail price. Put that amount in source_price, preserve its exact heading in source_price_column, and leave unit_cost and rrp null. Never discard it.
- Determine whether costs include tax only from explicit headings or arithmetic evidence. Otherwise use unknown.
- Preserve a brand or product type only when it is explicitly printed in the source.
- Extract the invoice supplier from its header, logo text, or seller details. Do not confuse the customer or delivery recipient with the supplier.
- Extract a product brand from the product line, description, or a clearly labelled brand field. When the invoice clearly represents the supplier's own single brand, brand may be the supplier trading name. Do not apply the supplier as brand for a distributor or multi-brand wholesaler.`;

    const parts: Array<Record<string, unknown>> = [];
    if (file && !isTextFile) parts.push({ inlineData: { mimeType: file.type, data: Buffer.from(await file.arrayBuffer()).toString('base64') } });
    if (sourceText) parts.push({ text: `SOURCE DATA:\n${sourceText}` });
    parts.push({ text: prompt });

    const ai = createTrackedGoogleGenAI(apiKey, {
      businessId,
      area: 'document_extraction',
      operation: 'extract_bulk_products',
      actorType: 'user',
      referenceType: 'bulk_product_import',
    });
    let rawParsed: unknown;
    try {
      const result = await ai.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json' },
      } as any);
      const raw = String(result.text ?? '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      if (!raw) throw new Error('Empty response from AI');
      rawParsed = JSON.parse(raw);
    } catch (error) {
      await reportRuntimeIssue({
        businessId,
        source: 'ims_bulk_product_import',
        operation: 'extract_document',
        title: 'Bulk product document extraction failed',
        error,
        context: { sourceType: file?.type || 'pasted_text', fileSize: file?.size ?? 0, textLength: pastedText.length, modelId },
      });
      return NextResponse.json({ success: false, error: aiErrorMessage(error, modelId) }, { status: 500 });
    }

    const extraction = normalizeBulkProductDocumentImport(rawParsed);
    if (!extraction.products.length) return NextResponse.json({ success: false, error: 'No product lines were found in that source.' }, { status: 422 });
    return NextResponse.json({ success: true, extraction });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_bulk_product_import',
      operation: 'prepare_document_extraction',
      title: 'Bulk product document import could not be prepared',
      error,
      context: { sourceType: file?.type || 'pasted_text', fileSize: file?.size ?? 0, textLength: pastedText.length, modelId },
    });
    return NextResponse.json({ success: false, error: 'Product document import could not be prepared.' }, { status: 500 });
  }
}
