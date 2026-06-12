import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { getIMSPool } from '@/services/IMSMySQLService';
import { getInventorySource } from '@/lib/dataProvider';

const BATCH_SIZE = 50;

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
  }

  const body = await req.json();
  const databaseId: string = String(body?.databaseId ?? '').trim();
  const calibration: Record<string, string> = body?.calibration ?? {};

  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  }

  let inventorySystemId = databaseId;
  let modelId = 'gemini-2.5-flash-preview-04-17';
  let source = 'cin7';

  try {
    const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
    if (conn?.gemini_model) modelId = conn.gemini_model;
    inventorySystemId = await resolveInventorySystemId(databaseId).catch(() => databaseId);
    source = await getInventorySource(databaseId).catch(() => 'cin7');
  } catch { /* use defaults */ }

  let productRows: string[][];
  try {
    if (source === 'solvantis') {
      const pool = getIMSPool();
      // Ensure column exists before reading
      await pool.query(
        `ALTER TABLE ims_product_variants ADD COLUMN IF NOT EXISTS volume TINYINT UNSIGNED NULL DEFAULT NULL`
      );
      const [rows] = await pool.query<any>(
        `SELECT v.variant_id AS option_id, v.sku AS code, p.name, p.brand, v.volume
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         WHERE v.is_active = 1 AND p.is_active = 1
         ORDER BY p.name, v.sku`,
        [],
      ) as any;
      if (!rows || rows.length === 0) {
        return NextResponse.json({ success: false, error: 'No active products found in IMS.' }, { status: 400 });
      }
      const headers = ['optionId', 'code', 'name', 'brand', 'volume'];
      const data: string[][] = (rows as any[]).map(r => [
        String(r.option_id ?? ''),
        String(r.code ?? ''),
        String(r.name ?? ''),
        String(r.brand ?? ''),
        String(r.volume ?? ''),
      ]);
      productRows = [headers, ...data];
    } else {
      const rows = await ProductsRepository.list(inventorySystemId);
      if (!rows || rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Products sheet is empty.' }, { status: 400 });
      }
      const headers = ['optionId', 'code', 'name', 'brand', 'volume'];
      const data: string[][] = rows.map(r => [
        String(r.option_id ?? ''),
        String(r.code ?? ''),
        String(r.name ?? ''),
        String(r.brand ?? ''),
        String(r.volume ?? ''),
      ]);
      productRows = [headers, ...data];
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to read products: ${e.message}` }, { status: 500 });
  }

  const hdr = productRows[0] ?? [];
  const optionIdIdx = hdr.indexOf('optionId');
  const codeIdx     = hdr.indexOf('code');
  const nameIdx     = hdr.indexOf('name');
  const brandIdx    = hdr.indexOf('brand');
  const volumeIdx   = hdr.indexOf('volume');

  if (volumeIdx < 0) {
    return NextResponse.json({ success: false, error: 'Products do not have a "volume" field. Add it via Volume Calibration first.' }, { status: 400 });
  }

  // Find rows with no volume set
  const unsetRows: { rowIndex: number; optionId: string; code: string; name: string; brand: string }[] = [];
  productRows.slice(1).forEach((row, i) => {
    const vol = String(row[volumeIdx] ?? '').trim();
    if (!vol) {
      unsetRows.push({
        rowIndex: i + 2, // 1-based, accounting for header row
        optionId: String(row[optionIdIdx] ?? '').trim(),
        code: String(row[codeIdx] ?? '').trim(),
        name: String(row[nameIdx] ?? '').trim(),
        brand: String(row[brandIdx] ?? '').trim(),
      });
    }
  });

  const totalUnset = unsetRows.length;

  if (totalUnset === 0) {
    return NextResponse.json({
      success: true,
      estimates: [],
      totalUnset: 0,
      message: 'All products already have a volume set.',
    });
  }

  // Build calibration context (shared across all batches)
  const calibrationLines = Object.entries(calibration)
    .filter(([, desc]) => desc?.trim())
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([level, desc]) => `  Level ${level}: ${desc.trim()}`)
    .join('\n');

  const calibrationSection = calibrationLines
    ? `CALIBRATION (user-defined examples for each volume level):\n${calibrationLines}`
    : 'No calibration provided — use your best judgment based on typical retail products.';

  const basePromptHeader = `You are a retail space planning assistant. Your job is to estimate how much physical display space a product takes up in a retail store, on a scale of 1 to 10.

SCALE DEFINITION:
- 1 = Takes the absolute minimum space (tiny item, e.g. small earrings, phone charm)
- 5 = Medium sized product (e.g. a folded t-shirt, a medium-sized handbag)
- 10 = Takes the most space (e.g. a large backpack, bulky outerwear)
- The scale is roughly proportional: a level 10 product takes approximately 5x the display space of a level 2 product

${calibrationSection}

INSTRUCTIONS:
- Estimate a volume rating from 1 to 10 for each product below
- Base your estimate on the product name, code, and brand
- Return ONLY a JSON array in this exact format (no other text):
[{"index":1,"volume":3},{"index":2,"volume":7},...]

PRODUCTS TO ESTIMATE:`;

  const ai = new GoogleGenAI({ apiKey });
  const allResults: { rowIndex: number; optionId: string; code: string; name: string; brand: string; estimatedVolume: number | null }[] = [];

  // Process all unset rows in batches of BATCH_SIZE
  for (let offset = 0; offset < unsetRows.length; offset += BATCH_SIZE) {
    const batch = unsetRows.slice(offset, offset + BATCH_SIZE);
    const productList = batch
      .map((p, i) => `${i + 1}. Code: ${p.code || 'N/A'} | Name: ${p.name || 'N/A'} | Brand: ${p.brand || 'N/A'}`)
      .join('\n');

    const prompt = `${basePromptHeader}\n${productList}`;

    let batchEstimates: { index: number; volume: number }[] = [];
    try {
      const result = await ai.models.generateContent({ model: modelId, contents: prompt });
      const text = result.text?.trim() ?? '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          batchEstimates = parsed
            .filter(e => typeof e.index === 'number' && typeof e.volume === 'number')
            .map(e => ({ index: e.index, volume: Math.min(10, Math.max(1, Math.round(e.volume))) }));
        }
      }
    } catch {
      // If a batch fails, leave estimatedVolume as null for those products
    }

    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      const est = batchEstimates.find(e => e.index === i + 1);
      allResults.push({
        rowIndex: p.rowIndex,
        optionId: p.optionId,
        code: p.code,
        name: p.name,
        brand: p.brand,
        estimatedVolume: est?.volume ?? null,
      });
    }
  }

  return NextResponse.json({
    success: true,
    estimates: allResults,
    totalUnset,
  });
}
