/**
 * GET /api/xero/sync-log?databaseId=xxx&limit=200
 *
 * Returns sync history for the Xero Sync tab:
 *   - Individual POs (po_bill)
 *   - Individual wholesale/b2b SOs (so_invoice) — NOT POS or Online SOs
 *   - Daily POS batch summaries (pos_batch) from pos_sales table
 *   - Daily Online batch summaries (online_batch) from ims_sales_orders WHERE so_type='online'
 *
 * Queries split across IMS DB (orders) and main DB (xero_sync_log) then merged in JS.
 *
 * Batch key format:
 *   pos_batch:    "{YYYY-MM-DD}_{locationId}"  (e.g. "2026-06-16_1")
 *   online_batch: "{YYYY-MM-DD}"               (e.g. "2026-06-17")
 * The same key is stored in xero_sync_log.detail when batch syncs run.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';

/** Extract "YYYY-MM-DD" from a MySQL DATE value (Date object or string). */
function batchDateStr(v: unknown): string {
  if (!v) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.substring(0, 10);
}

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  const limit = Math.min(Number(searchParams.get('limit') || 200), 200);

  try {
    // ── 1. Recent POs from IMS DB ─────────────────────────────────────────
    const pos = await imsQuery<any>(
      `SELECT po.id, po.po_number, po.total_amount, po.order_date, po.is_historical,
              po.xero_sync_status, po.xero_synced_at,
              COALESCE(c.name, po.supplier_name_raw) AS contact_name
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
        WHERE po.status NOT IN ('cancelled','draft')
        ORDER BY po.order_date DESC, po.id DESC
        LIMIT ?`,
      [limit],
    );

    // ── 2. Wholesale/B2B SOs only — exclude POS and Online types ──────────
    const sos = await imsQuery<any>(
      `SELECT so.id, so.so_number, so.total_amount, so.order_date,
              0 AS is_historical, so.xero_sync_status, so.xero_synced_at,
              COALESCE(c.name, '') AS contact_name
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
        WHERE (so.so_type IS NULL OR so.so_type NOT IN ('online', 'pos'))
          AND so.status NOT IN ('cancelled','draft')
        ORDER BY so.order_date DESC, so.id DESC
        LIMIT ?`,
      [limit],
    );

    // ── 3. POS daily batches from pos_sales (grouped by date + location) ──
    const posBatches = await imsQuery<any>(
      `SELECT DATE(ps.completed_at) AS batch_date,
              ps.location_id,
              COALESCE(l.name, CONCAT('Location ', ps.location_id)) AS location_name,
              COUNT(*) AS sale_count,
              SUM(ps.total) AS total_amount
         FROM pos_sales ps
         LEFT JOIN ims_locations l ON l.id = ps.location_id
        WHERE ps.status = 'completed' AND ps.sale_type = 'sale'
        GROUP BY DATE(ps.completed_at), ps.location_id
        ORDER BY batch_date DESC, ps.location_id ASC
        LIMIT ?`,
      [limit],
    );

    // ── 4. Online daily batches from ims_sales_orders WHERE so_type='online' ──
    const onlineBatches = await imsQuery<any>(
      `SELECT DATE(so.order_date) AS batch_date,
              COUNT(*) AS sale_count,
              SUM(so.total_amount) AS total_amount
         FROM ims_sales_orders so
        WHERE so.so_type = 'online'
          AND so.status NOT IN ('cancelled','draft')
        GROUP BY DATE(so.order_date)
        ORDER BY batch_date DESC
        LIMIT ?`,
      [limit],
    );

    // ── 5. Build IDs / keys for sync log lookups ──────────────────────────
    const poIds = pos.map((p: any) => p.id as number);
    const soIds = sos.map((s: any) => s.id as number);

    const posBatchKeys = posBatches.map(
      (b: any) => `${batchDateStr(b.batch_date)}_${b.location_id}`,
    );
    const onlineBatchKeys = onlineBatches.map((b: any) => batchDateStr(b.batch_date));
    const allBatchKeys = [...posBatchKeys, ...onlineBatchKeys];

    // ── 6. Sync log lookups (main DB) ─────────────────────────────────────
    let poLogs: any[] = [];
    let paymentLogs: any[] = [];
    let soLogs: any[] = [];
    let batchLogs: any[] = [];

    if (poIds.length > 0) {
      poLogs = await query<any>(
        `SELECT reference_id, xero_id, status, detail, created_at AS synced_at
           FROM xero_sync_log
          WHERE business_id = ? AND sync_type = 'po_bill'
            AND reference_id IN (${poIds.map(() => '?').join(',')})
            AND id IN (
              SELECT MAX(id) FROM xero_sync_log
               WHERE business_id = ? AND sync_type = 'po_bill'
               GROUP BY reference_id
            )`,
        [databaseId, ...poIds, databaseId],
      );
      paymentLogs = await query<any>(
        `SELECT reference_id AS po_id, xero_id, status, detail, created_at AS synced_at
           FROM xero_sync_log
          WHERE business_id = ? AND sync_type = 'po_payment'
            AND reference_id IN (${poIds.map(() => '?').join(',')})
          ORDER BY created_at DESC`,
        [databaseId, ...poIds],
      );
    }
    if (soIds.length > 0) {
      soLogs = await query<any>(
        `SELECT reference_id, xero_id, status, detail, created_at AS synced_at
           FROM xero_sync_log
          WHERE business_id = ? AND sync_type = 'so_invoice'
            AND reference_id IN (${soIds.map(() => '?').join(',')})
            AND id IN (
              SELECT MAX(id) FROM xero_sync_log
               WHERE business_id = ? AND sync_type = 'so_invoice'
               GROUP BY reference_id
            )`,
        [databaseId, ...soIds, databaseId],
      );
    }
    if (allBatchKeys.length > 0) {
      batchLogs = await query<any>(
        `SELECT detail AS batch_key, sync_type, xero_id, status, created_at AS synced_at
           FROM xero_sync_log
          WHERE business_id = ? AND sync_type IN ('pos_batch','online_batch')
            AND detail IN (${allBatchKeys.map(() => '?').join(',')})
            AND id IN (
              SELECT MAX(id) FROM xero_sync_log
               WHERE business_id = ? AND sync_type IN ('pos_batch','online_batch')
               GROUP BY detail
            )`,
        [databaseId, ...allBatchKeys, databaseId],
      );
    }

    // ── 7. Index logs ─────────────────────────────────────────────────────
    const poLogByRef = new Map(poLogs.map((r: any) => [r.reference_id, r]));
    const soLogByRef = new Map(soLogs.map((r: any) => [r.reference_id, r]));
    const batchLogByKey = new Map(batchLogs.map((r: any) => [r.batch_key, r]));
    const paysByPo = new Map<number, any[]>();
    for (const p of paymentLogs) {
      const arr = paysByPo.get(p.po_id) ?? [];
      arr.push(p);
      paysByPo.set(p.po_id, arr);
    }

    // ── 8. Shape entries ──────────────────────────────────────────────────
    const poEntries = pos.map((po: any) => {
      const log = poLogByRef.get(po.id);
      return {
        sync_type: 'po_bill',
        reference_id: po.id,
        reference: po.po_number,
        contact_name: po.contact_name || null,
        amount: po.total_amount,
        item_date: po.order_date,
        is_historical: po.is_historical ? 1 : 0,
        xero_sync_status: po.xero_sync_status || null,
        log_id: null,
        xero_id: log?.xero_id ?? null,
        last_sync_status: log?.status ?? null,
        last_sync_detail: log?.detail ?? null,
        last_sync_at: log?.synced_at ?? null,
        payments: (paysByPo.get(po.id) ?? []).map((p: any) => ({
          id: null, po_id: po.id, xero_id: p.xero_id, status: p.status,
          detail: p.detail, synced_at: p.synced_at,
          payment_date: null, amount: null, currency_code: null, notes: null,
        })),
      };
    });

    const soEntries = sos.map((so: any) => {
      const log = soLogByRef.get(so.id);
      return {
        sync_type: 'so_invoice',
        reference_id: so.id,
        reference: so.so_number,
        contact_name: so.contact_name || null,
        amount: so.total_amount,
        item_date: so.order_date,
        is_historical: 0,
        xero_sync_status: so.xero_sync_status || null,
        log_id: null,
        xero_id: log?.xero_id ?? null,
        last_sync_status: log?.status ?? null,
        last_sync_detail: log?.detail ?? null,
        last_sync_at: log?.synced_at ?? null,
        payments: [],
      };
    });

    const posBatchEntries = posBatches.map((b: any) => {
      const dateStr = batchDateStr(b.batch_date);
      const key = `${dateStr}_${b.location_id}`;
      const log = batchLogByKey.get(key);
      return {
        sync_type: 'pos_batch',
        reference_id: null,
        reference: `POS ${dateStr} — ${b.location_name} (${b.sale_count})`,
        contact_name: null,
        amount: b.total_amount,
        item_date: dateStr,
        is_historical: 0,
        xero_sync_status: null,
        log_id: null,
        xero_id: log?.xero_id ?? null,
        last_sync_status: log?.status ?? null,
        last_sync_detail: key,
        last_sync_at: log?.synced_at ?? null,
        payments: [],
      };
    });

    const onlineBatchEntries = onlineBatches.map((b: any) => {
      const dateStr = batchDateStr(b.batch_date);
      const log = batchLogByKey.get(dateStr);
      return {
        sync_type: 'online_batch',
        reference_id: null,
        reference: `Online ${dateStr} (${b.sale_count} orders)`,
        contact_name: null,
        amount: b.total_amount,
        item_date: dateStr,
        is_historical: 0,
        xero_sync_status: null,
        log_id: null,
        xero_id: log?.xero_id ?? null,
        last_sync_status: log?.status ?? null,
        last_sync_detail: dateStr,
        last_sync_at: log?.synced_at ?? null,
        payments: [],
      };
    });

    // Merge + sort by item_date DESC, then slice to limit
    const entries = [...poEntries, ...soEntries, ...posBatchEntries, ...onlineBatchEntries]
      .sort((a, b) => {
        const da = a.item_date ? new Date(a.item_date).getTime() : 0;
        const db2 = b.item_date ? new Date(b.item_date).getTime() : 0;
        return db2 - da;
      })
      .slice(0, limit);

    return NextResponse.json({ entries });
  } catch (err: any) {
    console.error('[xero/sync-log]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

