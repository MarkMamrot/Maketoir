import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

const SHEET = 'ProductDescTemplate';
// Fixed row positions (1-based in Sheets, so rows 2-4 are data rows after header)
const SCHEMA_KEYS = ['description', 'title', 'tags'] as const;
type SchemaKey = typeof SCHEMA_KEYS[number];

/** Resolve the Business Website spreadsheet ID from the database Config tab. */
async function resolveWebsiteSheetId(sheets: GoogleSheetsService, databaseId: string): Promise<string | null> {
  try {
    const config = await sheets.getData(databaseId, 'Config!A:B');
    const row = (config as string[][]).find(r => r[0] === 'WebsiteSheetId');
    return row?.[1] || null;
  } catch { return null; }
}

/**
 * Parse the sheet into a { description, title, tags } map.
 * Handles both the old single-row format (row 2 key = 'Timestamp') and
 * the new key-value format (row 2 key = 'description', etc.).
 */
function parseSheetRows(rows: string[][]): Record<SchemaKey, any | null> {
  const result: Record<SchemaKey, any | null> = { description: null, title: null, tags: null };
  if (!rows || rows.length < 2) return result;

  const headerRow = rows[0];
  const dataRows = rows.slice(1); // skip header

  // Back-compat: old format had 'Timestamp' as the header in column A (not 'Key')
  if (headerRow[0]?.trim() === 'Timestamp') {
    const jsonStr = dataRows[0]?.[1]?.trim();
    if (jsonStr) { try { result.description = JSON.parse(jsonStr); } catch { /* corrupt */ } }
    return result;
  }

  for (const row of dataRows) {
    const key = row[0]?.trim() as SchemaKey;
    const val = row[1]?.trim();
    if (key && SCHEMA_KEYS.includes(key) && val) {
      try { result[key] = JSON.parse(val); } catch { result[key] = val; }
    }
  }
  return result;
}

/**
 * Build the full 4 rows to write (header + one row per schema key).
 * Preserves existing values for keys not being updated.
 */
function buildSheetRows(
  current: Record<SchemaKey, any | null>,
  key: SchemaKey,
  schema: any,
): string[][] {
  const updated = { ...current, [key]: schema };
  return [
    ['Key', 'Value'],
    ['description', updated.description ? JSON.stringify(updated.description) : ''],
    ['title',       updated.title       ? JSON.stringify(updated.title)       : ''],
    ['tags',        updated.tags        ? JSON.stringify(updated.tags)        : ''],
  ];
}

export async function GET(req: Request) {
  try {
    const sessionCookie = cookies().get('marketoir_session');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const databaseId = searchParams.get('databaseId');
    if (!databaseId) {
      return NextResponse.json({ error: 'Missing databaseId.' }, { status: 400 });
    }

    const sheets = new GoogleSheetsService();
    const websiteSheetId = await resolveWebsiteSheetId(sheets, databaseId);
    if (!websiteSheetId) return NextResponse.json({ description: null, title: null, tags: null });

    try {
      const data = await sheets.getData(websiteSheetId, `${SHEET}!A:B`) as string[][];
      return NextResponse.json(parseSheetRows(data ?? []));
    } catch { /* sheet not yet created */ }

    return NextResponse.json({ description: null, title: null, tags: null });
  } catch (error: any) {
    console.error('product-schema GET error:', error);
    return NextResponse.json({ error: 'Failed to read templates.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sessionCookie = cookies().get('marketoir_session');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const body = await req.json();
    const { databaseId, key, schema } = body as { databaseId: string; key: SchemaKey; schema: any };

    if (!databaseId || !key || !schema) {
      return NextResponse.json({ error: 'Missing databaseId, key, or schema.' }, { status: 400 });
    }
    if (!SCHEMA_KEYS.includes(key)) {
      return NextResponse.json({ error: `Invalid key "${key}". Must be one of: ${SCHEMA_KEYS.join(', ')}.` }, { status: 400 });
    }

    const sheets = new GoogleSheetsService();
    const websiteSheetId = await resolveWebsiteSheetId(sheets, databaseId);
    if (!websiteSheetId) {
      return NextResponse.json({ error: 'Website sheet not found. Sync Shopify first to create it.' }, { status: 400 });
    }

    await sheets.addSheetIfNotExists(websiteSheetId, SHEET, ['Key', 'Value']);

    // Read current state
    let current: Record<SchemaKey, any | null> = { description: null, title: null, tags: null };
    try {
      const data = await sheets.getData(websiteSheetId, `${SHEET}!A:B`) as string[][];
      current = parseSheetRows(data ?? []);
    } catch { /* fresh sheet */ }

    // Write all four rows back (header + 3 data rows) with the updated key
    const rows = buildSheetRows(current, key, schema);
    await sheets.updateData(websiteSheetId, `${SHEET}!A1:B4`, rows);

    return NextResponse.json({ success: true, message: `${key} schema saved.` });
  } catch (error: any) {
    console.error('product-schema POST error:', error);
    return NextResponse.json({ error: 'Failed to save schema.' }, { status: 500 });
  }
}
