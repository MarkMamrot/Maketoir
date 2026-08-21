import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import {
  matchSalesOrderCustomer,
  matchSalesOrderVariant,
  normalizeSalesOrderUpload,
  type SalesOrderUploadCustomer,
  type SalesOrderUploadVariant,
} from '@/lib/ims/salesOrderUploadParser';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

export const runtime = 'nodejs';
export const maxDuration = 120;

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

function aiErrorMessage(error: unknown, modelId: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes('RESOURCE_EXHAUSTED')) return 'AI quota exceeded - try again in a moment.';
  if (detail.includes('INVALID_ARGUMENT') || detail.includes('400')) return `AI rejected the request: ${detail.slice(0, 120)}`;
  if (detail.includes('404') || detail.toLowerCase().includes('not found')) {
    return `Model "${modelId}" not found - update your AI model in Foresight settings.`;
  }
  return `AI error: ${detail.slice(0, 200)}`;
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const businessId = session.businessId as string;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  let file: File | null = null;
  try {
    const formData = await req.formData();
    file = formData.get('file') as File | null;
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type. Use PDF, JPEG, PNG, or WebP.' }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 20 MB).' }, { status: 400 });
  }

  let modelId = 'gemini-2.5-flash-preview-04-17';
  try {
    const connection = await ConnectionsRepository.get(businessId);
    if ((connection as any)?.gemini_model) modelId = (connection as any).gemini_model;
  } catch {
    // Use the default model when optional connection settings are unavailable.
  }

  try {
    const [customers, variants] = await Promise.all([
      imsQuery<SalesOrderUploadCustomer>(
        `SELECT id, name, email, COALESCE(NULLIF(mobile, ''), phone) AS phone, price_tier,
                address, address2, suburb, city, state, postcode, country
           FROM ims_contacts
          WHERE business_id = ? AND type = 'b2b_customer' AND is_active = 1
          ORDER BY name`,
        [businessId],
      ),
      imsQuery<SalesOrderUploadVariant>(
        `SELECT v.variant_id, v.sku, v.barcode, v.price_rrp, v.price_rrp_sale, v.price_wholesale,
                p.name AS product_name,
                CONCAT_WS(' / ', NULLIF(v.option1_value, ''), NULLIF(v.option2_value, ''), NULLIF(v.option3_value, '')) AS variant_label
           FROM ims_product_variants v
           JOIN ims_products p ON p.product_id = v.product_id
          WHERE p.business_id = ? AND p.is_active = 1 AND v.is_active = 1
          ORDER BY p.name, v.sku`,
        [businessId],
      ),
    ]);

    const prompt = `You are reading a customer's purchase order sent to a supplier. Extract only what the customer wants to order.

Return ONLY a valid JSON object, with no markdown or commentary:
{
  "customer_name": "customer or company name, or null",
  "customer_email": "customer email, or null",
  "customer_phone": "customer phone, or null",
  "customer_po_number": "the customer's PO or order reference, or null",
  "order_date": "YYYY-MM-DD, or null",
  "delivery_address": {
    "address": "street address line 1, or null",
    "address2": "street address line 2, or null",
    "suburb": "suburb, or null",
    "city": "city, or null",
    "state": "state or region, or null",
    "postcode": "postcode, preserving leading zeroes, or null",
    "country": "country, or null"
  },
  "notes": ["delivery instructions or customer notes"],
  "line_items": [
    {
      "product_code": "SKU, item code, or style code, preserving leading zeroes, or null",
      "barcode": "barcode, EAN, UPC, or GTIN, preserving leading zeroes, or null",
      "product_name": "product description",
      "variant_description": "colour, size, or other variant details, or null",
      "qty": 1
    }
  ]
}

Rules:
- Extract every product the customer is requesting and its requested quantity.
- Do not extract prices, discounts, freight, tax, totals, currency, payment terms, or product costs.
- Do not infer or propose new products. Use only text visible in the document.
- Do not treat totals, comments, delivery fees, or blank rows as products.
- Prefer the delivery or ship-to address over billing, postal, or supplier addresses.
- Notes should contain only actionable customer instructions, not legal boilerplate or payment details.`;

    const base64Data = Buffer.from(await file.arrayBuffer()).toString('base64');
    let rawParsed: unknown;
    try {
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: modelId,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: file.type, data: base64Data } } as any,
            { text: prompt },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      } as any);
      const raw = (result.text ?? '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      if (!raw) throw new Error('Empty response from AI');
      rawParsed = JSON.parse(raw);
    } catch (error) {
      await reportRuntimeIssue({
        businessId,
        source: 'ims_sales_order_upload',
        operation: 'parse_document',
        title: 'Customer sales order document parsing failed',
        error,
        context: { fileType: file.type, fileSize: file.size, modelId },
      });
      return NextResponse.json({ error: aiErrorMessage(error, modelId) }, { status: 500 });
    }

    const salesOrder = normalizeSalesOrderUpload(rawParsed);
    const matchedCustomer = matchSalesOrderCustomer(salesOrder, customers);
    const lineResults = salesOrder.line_items.map(line => ({
      sales_order_line: line,
      match: matchSalesOrderVariant(line, variants),
    }));

    return NextResponse.json({
      success: true,
      sales_order: salesOrder,
      matched_customer: matchedCustomer,
      line_results: lineResults,
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_sales_order_upload',
      operation: 'prepare_import',
      title: 'Customer sales order upload preparation failed',
      error,
      context: { fileType: file.type, fileSize: file.size },
    });
    const message = error instanceof Error ? error.message : 'Failed to prepare the sales order upload.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}