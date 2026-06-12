/**
 * POST /api/website/bulk-edit/commit
 *
 * Reads BulkEdit_Review tab from Business_Website spreadsheet, pushes all
 * rows with status "pending" to Shopify, updates each row's status in place,
 * and appends a summary record to BulkEdit_History.
 *
 * Streams SSE progress events.
 * Body: { databaseId: string }
 */
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { ShopifyService } from '@/services/ShopifyService';
import { decrypt } from '@/lib/encryption';

const REVIEW_SHEET  = 'BulkEdit_Review';
const HISTORY_SHEET = 'BulkEdit_History';
const HISTORY_HEADERS = ['run_at', 'fields_updated', 'total', 'succeeded', 'failed', 'details_json'];

// Column indices in BulkEdit_Review (matches REVIEW_HEADERS in preview route)
const COL = {
  product_id:  0,
  title:       1,
  old_desc:    3,
  new_desc:    4,
  old_tags:    5,
  new_tags:    6,
  status:      7,
  committed_at: 8,
  error:       9,
  new_title:   10, // col K
} as const;

function errMsg(e: any): string {
  if (e?.errors?.[0]?.message) return e.errors[0].message;
  if (e?.message) return e.message;
  try { return JSON.stringify(e); } catch { return 'Unknown error'; }
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401 });
  }

  const { databaseId, addOptimisedTag = true } = await req.json() as { databaseId: string; addOptimisedTag?: boolean };
  if (!databaseId) {
    return new Response(JSON.stringify({ error: 'databaseId is required.' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const sheets = new GoogleSheetsService();

        // ── Resolve website sheet ─────────────────────────────────────────
        const config = await sheets.getData(databaseId, 'Config!A:B');
        const wsRow = (config as string[][]).find(r => r[0] === 'WebsiteSheetId');
        const websiteSheetId = wsRow?.[1];
        if (!websiteSheetId) {
          emit({ status: 'error', error: 'Website sheet not found.' });
          controller.close();
          return;
        }

        // ── Read Shopify credentials ──────────────────────────────────────
        const connRows = await sheets.getData(databaseId, 'Connections') as string[][];
        if (!connRows || connRows.length < 2) {
          emit({ status: 'error', error: 'Shopify credentials not configured.' });
          controller.close();
          return;
        }
        const [hdrs, vals] = connRows;
        const get = (k: string) => vals[hdrs.indexOf(k)] ?? '';
        const shopName = get('ShopifyShopId').replace(/\.myshopify\.com$/, '');
        if (!shopName || !/^[a-zA-Z0-9-]+$/.test(shopName)) {
          emit({ status: 'error', error: 'Invalid Shopify shop name in Connections.' });
          controller.close();
          return;
        }
        const shopify = new ShopifyService(shopName, decrypt(get('ShopifyAccessToken')));

        // ── Read review sheet ─────────────────────────────────────────────
        let reviewData: string[][];
        try {
          reviewData = await sheets.getData(websiteSheetId, REVIEW_SHEET) as string[][];
        } catch {
          emit({ status: 'error', error: 'BulkEdit_Review sheet not found. Generate a preview first.' });
          controller.close();
          return;
        }

        if (!reviewData || reviewData.length < 2) {
          emit({ status: 'error', error: 'No preview data found. Generate a preview first.' });
          controller.close();
          return;
        }

        // Data rows start at row 2 (sheetRow is 1-based)
        const pendingRows = reviewData
          .slice(1)
          .map((row, i) => ({ row, sheetRow: i + 2 }))
          .filter(({ row }) => row[COL.status] === 'pending');

        if (!pendingRows.length) {
          emit({ status: 'error', error: 'No pending rows to commit. All items may already be committed or failed.' });
          controller.close();
          return;
        }

        emit({ status: 'start', total: pendingRows.length });

        let succeeded = 0;
        let failed = 0;
        const details: Array<{ id: string; title: string; status: string; error?: string }> = [];
        const updatedFields = new Set<string>();

        for (const { row, sheetRow } of pendingRows) {
          const productId = row[COL.product_id]?.trim();
          const title = row[COL.title] || `Product ${productId}`;
          const newDesc  = row[COL.new_desc]?.trim();
          const newTags  = row[COL.new_tags]?.trim();
          const newTitle = row[COL.new_title]?.trim();

          if (!productId) continue;

          const updates: Record<string, any> = {};
          if (newTitle) { updates.title    = newTitle; updatedFields.add('title'); }
          if (newDesc)  { updates.body_html = newDesc;  updatedFields.add('description'); }

          // Optionally append the BulkOptimised tag with today's date
          const existingTags = row[COL.old_tags]?.trim() || '';
          const baseTags = newTags || existingTags;
          if (addOptimisedTag) {
            const optimisedTag = `BulkOptimised-${new Date().toISOString().slice(0, 10)}`;
            const cleanedTags = baseTags
              .split(',')
              .map((t: string) => t.trim())
              .filter((t: string) => t && !t.startsWith('BulkOptimised-'))
              .concat(optimisedTag)
              .join(', ');
            updates.tags = cleanedTags;
            updatedFields.add('tags');
          } else if (newTags) {
            updates.tags = newTags;
            updatedFields.add('tags');
          }

          if (!Object.keys(updates).length) {
            // Nothing to push — mark as committed
            await sheets.updateData(websiteSheetId, `${REVIEW_SHEET}!H${sheetRow}:J${sheetRow}`, [
              ['committed', new Date().toISOString(), ''],
            ]);
            succeeded++;
            details.push({ id: productId, title, status: 'committed' });
            emit({ status: 'progress', product: title, result: 'success' });
            continue;
          }

          try {
            await shopify.updateProduct(Number(productId), updates);
            await sheets.updateData(websiteSheetId, `${REVIEW_SHEET}!H${sheetRow}:J${sheetRow}`, [
              ['committed', new Date().toISOString(), ''],
            ]);
            succeeded++;
            details.push({ id: productId, title, status: 'committed' });
            emit({ status: 'progress', product: title, result: 'success' });
          } catch (e: any) {
            const err = errMsg(e);
            await sheets.updateData(websiteSheetId, `${REVIEW_SHEET}!H${sheetRow}:J${sheetRow}`, [
              ['failed', new Date().toISOString(), err],
            ]);
            failed++;
            details.push({ id: productId, title, status: 'failed', error: err });
            emit({ status: 'progress', product: title, result: 'error', error: err });
          }
        }

        // ── Append history record ─────────────────────────────────────────
        await sheets.addSheetIfNotExists(websiteSheetId, HISTORY_SHEET, HISTORY_HEADERS);
        await sheets.appendData(websiteSheetId, `${HISTORY_SHEET}!A:F`, [[
          new Date().toISOString(),
          Array.from(updatedFields).join(', ') || 'none',
          String(pendingRows.length),
          String(succeeded),
          String(failed),
          JSON.stringify(details),
        ]]);

        const reviewUrl = `https://docs.google.com/spreadsheets/d/${websiteSheetId}`;
        emit({ status: 'done', succeeded, failed, reviewUrl });

      } catch (e: any) {
        emit({ status: 'error', error: errMsg(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
