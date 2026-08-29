import { createTrackedGoogleGenAI } from '@/lib/ai/billing/googleGateway';
import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { resolveBusinessAiModel } from '@/lib/ai/businessModelPreferences';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

export const runtime = 'nodejs';
export const maxDuration = 60;

type VariantRow = {
  variant_id: string;
  sku: string | null;
  barcode: string | null;
  product_name: string | null;
  variant_label: string | null;
};

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  const businessId = session.businessId as string;

  let salesOrderLines: any[];
  try {
    const body = await req.json();
    salesOrderLines = body.sales_order_lines;
    if (!Array.isArray(salesOrderLines) || salesOrderLines.length === 0 || salesOrderLines.length > 100) {
      return NextResponse.json({ error: 'sales_order_lines must contain between 1 and 100 lines.' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const variants = await imsQuery<VariantRow>(
      `SELECT v.variant_id, v.sku, v.barcode, p.name AS product_name,
              CONCAT_WS(' / ', NULLIF(v.option1_value, ''), NULLIF(v.option2_value, ''), NULLIF(v.option3_value, '')) AS variant_label
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ? AND p.is_active = 1 AND v.is_active = 1
        ORDER BY p.name, v.sku
        LIMIT 5000`,
      [businessId],
    );
    if (variants.length === 0) return NextResponse.json({ error: 'No active products are available in IMS.' }, { status: 404 });

    let modelId = resolveBusinessAiModel(null, 'catalogueMatching');
    try {
      const connection = await ConnectionsRepository.get(businessId);
      modelId = resolveBusinessAiModel(connection, 'catalogueMatching');
    } catch {
      // Use the default model when optional connection settings are unavailable.
    }

    const prompt = `Match each customer purchase-order line to an existing active IMS variant.

CUSTOMER ORDER LINES:
${JSON.stringify(salesOrderLines)}

IMS VARIANTS:
${JSON.stringify(variants.map(variant => ({
  variant_id: variant.variant_id,
  sku: variant.sku ?? '',
  barcode: variant.barcode ?? '',
  name: [variant.product_name, variant.variant_label].filter(Boolean).join(' - '),
})))}

Return ONLY a JSON array with one result per input line:
[{"line_index":0,"variant_id":"existing-id-or-null","confidence":"high|medium|low|null","reason":"brief reason"}]

Use high confidence for clear SKU/barcode identity and medium for a uniquely convincing product plus variant match. Use low or null when ambiguous. Never invent a variant_id and never create a product.`;

    let rawMatches: any[];
    try {
      const ai = createTrackedGoogleGenAI(apiKey, {
        businessId,
        area: 'catalogue_matching',
        operation: 'match_customer_order_lines',
        actorType: 'user',
      });
      const result = await ai.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      } as any);
      const raw = (result.text ?? '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      if (!raw) throw new Error('Empty response from AI');
      const parsed = JSON.parse(raw);
      rawMatches = Array.isArray(parsed) ? parsed : parsed.matches ?? [];
    } catch (error) {
      await reportRuntimeIssue({
        businessId,
        source: 'ims_sales_order_upload',
        operation: 'match_lines',
        title: 'Customer sales order line matching failed',
        error,
        context: { lineCount: salesOrderLines.length, variantCount: variants.length, modelId },
      });
      const detail = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: `AI matching failed: ${detail.slice(0, 150)}` }, { status: 500 });
    }

    const validIds = new Set(variants.map(variant => variant.variant_id));
    const matches = rawMatches.map(match => {
      const confidence = ['high', 'medium', 'low'].includes(String(match?.confidence)) ? String(match.confidence) : null;
      const accepted = confidence === 'high' || confidence === 'medium';
      return {
        line_index: Number(match?.line_index),
        variant_id: accepted && validIds.has(String(match?.variant_id)) ? String(match.variant_id) : null,
        confidence,
        reason: typeof match?.reason === 'string' ? match.reason.slice(0, 300) : '',
      };
    });
    return NextResponse.json({ success: true, matches });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_sales_order_upload',
      operation: 'prepare_line_matching',
      title: 'Customer sales order line matching preparation failed',
      error,
      context: { lineCount: salesOrderLines.length },
    });
    const message = error instanceof Error ? error.message : 'Failed to prepare line matching.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}