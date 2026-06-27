/**
 * GET /api/xero/sync-log?databaseId=xxx&limit=200
 *
 * Returns sync history for the Xero Sync tab:
 *   - Individual POs (po_bill)
 *   - Individual wholesale/b2b SOs (so_invoice) — NOT POS or Online SOs
 *   - POS EOD reconciliation entries (eod_reconciliation) — per-method per-day Xero invoices
 *   - Stocktake journals (stocktake_journal)
 *   - Daily Online batch summaries (online_batch) from ims_sales_orders WHERE so_type='online'
 *
 * NOTE: POS sales are NOT shown as computed batch rows.  The actual Xero pushes happen
 * per payment method via the EOD Reconciliation screen (sync_type='eod_reconciliation')
 * and those entries from xero_sync_log are surfaced directly.
 *
 * Queries split across IMS DB (orders) and main DB (xero_sync_log) then merged in JS.
 *
 * Online batch key format: "{YYYY-MM-DD}"  (e.g. "2026-06-17")
 * The same key is stored in xero_sync_log.detail when online batch syncs run.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';
import { xeroApiFetch } from '@/services/XeroService';

/** Extract "YYYY-MM-DD" from a MySQL DATE value (Date object or string). */
function batchDateStr(v: unknown): string {
  if (!v) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.substring(0, 10);
}

/**
 * One-shot migration: add xero_state column to xero_sync_log if it doesn’t exist.
 * Uses a module-level flag so it only runs once per server process.
 */
let _xeroStateColReady = false;
async function ensureXeroStateColumn(): Promise<void> {
  if (_xeroStateColReady) return;
  try {
    const existing = await query<any>(`SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'`, []);
    if (!existing.length) {
      await query(`ALTER TABLE xero_sync_log ADD COLUMN xero_state VARCHAR(20) DEFAULT NULL AFTER status`, []);
    }
  } catch { /* table may not exist yet — safe to ignore */ }
  _xeroStateColReady = true;
}

/**
 * Infer xero_state for rows inserted before the column was added (all pre-Jun-2026 rows are NULL).
 * Uses the detail text first (most specific), then falls back to sync_type.
 */
function resolveXeroState(
  syncType: string,
  status: string | null | undefined,
  detail: string | null | undefined,
  stored: string | null | undefined,
): string | null {
  if (stored) return stored;
  if (status !== 'success') return null;
  const d = (detail ?? '').toLowerCase();
  if (d.includes('approved')) return 'AUTHORISED';
  if (d.includes('voided'))   return 'VOIDED';
  if (d.includes('deleted'))  return 'DELETED';
  switch (syncType) {
    case 'po_bill':             return 'DRAFT';
    case 'po_bill_void':        return 'VOIDED';
    case 'so_invoice':          return 'DRAFT';
    case 'so_invoice_void':     return 'VOIDED';
    case 'eod_reconciliation':  return 'AUTHORISED';
    case 'stocktake_journal':   return 'POSTED';
    case 'online_batch':        return 'AUTHORISED';
    case 'po_payment':
    case 'so_payment':          return 'PAID';
    default:                    return null;
  }
}

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  // NOTE: limit is inlined into SQL below (not a placeholder) because mysql2
  // prepared statements (pool.execute) reject `LIMIT ?`. It is clamped to a
  // safe integer 1..200 so inlining is injection-safe.
  const limit = Math.max(1, Math.min(Math.floor(Number(searchParams.get('limit')) || 100), 100));
  // Ensure xero_state column exists (added Jun 2026 — no-op once column is present)
  await ensureXeroStateColumn();
  try {
    // ── 1. Recent POs from IMS DB ─────────────────────────────────────────
    const pos = await imsQuery<any>(
      `SELECT po.id, po.po_number, po.total_amount, po.order_date, po.is_historical,
              po.xero_sync_status, po.xero_synced_at,
              COALESCE(c.name, po.supplier_name_raw) AS contact_name
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
        WHERE po.status NOT IN ('cancelled','draft')
          AND (po.is_historical = 0 OR po.is_historical IS NULL)
        ORDER BY po.order_date DESC, po.id DESC
        LIMIT ${limit}`,
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
        LIMIT ${limit}`,
    );

    // ── 3. Online daily batches from ims_sales_orders WHERE so_type='online' ──
    //    (POS EOD recon is surfaced via eod_reconciliation in xero_sync_log, not here)
    const onlineBatches = await imsQuery<any>(
      `SELECT DATE(so.order_date) AS batch_date,
              COUNT(*) AS sale_count,
              SUM(so.total_amount) AS total_amount
         FROM ims_sales_orders so
        WHERE so.so_type = 'online'
          AND so.status NOT IN ('cancelled','draft')
        GROUP BY DATE(so.order_date)
        ORDER BY batch_date DESC
        LIMIT ${limit}`,
    );

    // ── 4. Build IDs / keys for sync log lookups ──────────────────────────
    const poIds = pos.map((p: any) => p.id as number);
    const soIds = sos.map((s: any) => s.id as number);
    const onlineBatchKeys = onlineBatches.map((b: any) => batchDateStr(b.batch_date));

    // ── 5. Sync log lookups (main DB) ───────────────────────────────────────────────
    let poLogs: any[] = [];
    let paymentLogs: any[] = [];
    let soLogs: any[] = [];
    let batchLogs: any[] = [];
    let eventLogs: any[] = [];

    try {
      if (poIds.length > 0) {
        poLogs = await query<any>(
          `SELECT reference_id, sync_type, xero_id, status, xero_state, detail, created_at AS synced_at
             FROM xero_sync_log
            WHERE business_id = ? AND sync_type IN ('po_bill','po_bill_void')
              AND reference_id IN (${poIds.map(() => '?').join(',')})
              AND id IN (
                SELECT MAX(id) FROM xero_sync_log
                 WHERE business_id = ? AND sync_type IN ('po_bill','po_bill_void')
                 GROUP BY reference_id
              )`,
          [databaseId, ...poIds, databaseId],
        );
        paymentLogs = await query<any>(
          `SELECT reference_id AS po_id, xero_id, status, xero_state, detail, created_at AS synced_at
             FROM xero_sync_log
            WHERE business_id = ? AND sync_type = 'po_payment'
              AND reference_id IN (${poIds.map(() => '?').join(',')})
            ORDER BY created_at DESC`,
          [databaseId, ...poIds],
        );
      }
      if (soIds.length > 0) {
        soLogs = await query<any>(
          `SELECT reference_id, sync_type, xero_id, status, xero_state, detail, created_at AS synced_at
             FROM xero_sync_log
            WHERE business_id = ? AND sync_type IN ('so_invoice','so_invoice_void')
              AND reference_id IN (${soIds.map(() => '?').join(',')})
              AND id IN (
                SELECT MAX(id) FROM xero_sync_log
                 WHERE business_id = ? AND sync_type IN ('so_invoice','so_invoice_void')
                 GROUP BY reference_id
              )`,
          [databaseId, ...soIds, databaseId],
        );
      }
      if (onlineBatchKeys.length > 0) {
        batchLogs = await query<any>(
          `SELECT detail AS batch_key, sync_type, xero_id, status, xero_state, created_at AS synced_at
             FROM xero_sync_log
            WHERE business_id = ? AND sync_type = 'online_batch'
              AND detail IN (${onlineBatchKeys.map(() => '?').join(',')})
              AND id IN (
                SELECT MAX(id) FROM xero_sync_log
                 WHERE business_id = ? AND sync_type = 'online_batch'
                 GROUP BY detail
              )`,
          [databaseId, ...onlineBatchKeys, databaseId],
        );
      }
      // Standalone sync events with no still-existing source document of their own
      // (POS end-of-day reconciliations, stocktake journals). These are the actual
      // Xero pushes — surface them directly so their status / amount / Xero ID show.
      eventLogs = await query<any>(
        `SELECT id, sync_type, xero_id, status, xero_state, detail, created_at AS synced_at
           FROM xero_sync_log
          WHERE business_id = ?
            AND sync_type IN ('eod_reconciliation','stocktake_journal')
          ORDER BY created_at DESC
          LIMIT ${limit}`,
        [databaseId],
      );
    } catch (logErr: any) {
      // xero_sync_log table may not yet exist — return PO/SO list with null sync status
      // rather than failing the whole request.
      console.warn('[xero/sync-log] xero_sync_log unavailable (table may not exist yet):', logErr?.message);
    }

    // ── 6. Index logs ────────────────────────────────────────────────────────────────────────────
    const poLogByRef = new Map(poLogs.map((r: any) => [r.reference_id, r]));
    const soLogByRef = new Map(soLogs.map((r: any) => [r.reference_id, r]));
    const batchLogByKey = new Map(batchLogs.map((r: any) => [r.batch_key, r]));
    const paysByPo = new Map<number, any[]>();
    for (const p of paymentLogs) {
      const arr = paysByPo.get(p.po_id) ?? [];
      arr.push(p);
      paysByPo.set(p.po_id, arr);
    }

    // ── 7. Shape entries ────────────────────────────────────────────────────────────────────────────
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
        last_xero_state: resolveXeroState(log?.sync_type ?? 'po_bill', log?.status, log?.detail, log?.xero_state),
        last_sync_detail: log?.detail ?? null,
        last_sync_at: log?.synced_at ?? null,
        payments: (paysByPo.get(po.id) ?? []).map((p: any) => ({
          id: null, po_id: po.id, xero_id: p.xero_id, status: p.status,
          xero_state: resolveXeroState('po_payment', p.status, p.detail, p.xero_state),
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
        last_xero_state: resolveXeroState(log?.sync_type ?? 'so_invoice', log?.status, log?.detail, log?.xero_state),
        last_sync_detail: log?.detail ?? null,
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
        last_xero_state: resolveXeroState('online_batch', log?.status, log?.detail, log?.xero_state),
        last_sync_detail: dateStr,
        last_sync_at: log?.synced_at ?? null,
        payments: [],
      };
    });

    // ── Standalone Xero sync events (EOD reconciliations, stocktake journals) ──
    const parseAmt = (detail: string | null): number | null => {
      if (!detail) return null;
      const m = /\$\s*([\d,]+(?:\.\d+)?)/.exec(detail);
      return m ? Number(m[1].replace(/,/g, '')) : null;
    };
    const eventEntries = eventLogs.map((e: any) => ({
      sync_type: e.sync_type,
      reference_id: null,
      reference:
        e.sync_type === 'eod_reconciliation'
          ? (e.detail ? String(e.detail).split(' — ')[0] : 'EOD Reconciliation')
          : 'Stocktake Journal',
      contact_name: e.detail ?? null,
      amount: parseAmt(e.detail),
      item_date: e.synced_at,
      is_historical: 0,
      xero_sync_status: null,
      log_id: e.id,
      xero_id: e.xero_id ?? null,
      last_sync_status: e.status ?? null,
      last_xero_state: resolveXeroState(e.sync_type, e.status, e.detail, e.xero_state),
      last_sync_detail: e.detail ?? null,
      last_sync_at: e.synced_at ?? null,
      payments: [],
    }));

    // Merge + sort by item_date DESC, then slice to limit
    const entries = [...poEntries, ...soEntries, ...onlineBatchEntries, ...eventEntries]
      .sort((a, b) => {
        const da = a.item_date ? new Date(a.item_date).getTime() : 0;
        const db2 = b.item_date ? new Date(b.item_date).getTime() : 0;
        return db2 - da;
      })
      .slice(0, limit);

    // ── Live Xero status fetch ─────────────────────────────────────────────────
    // For every entry that has a xero_id (bill or invoice), pull the current
    // status directly from Xero so voids/deletes done outside the app are shown.
    // Xero returns VOIDED invoices by ID; DELETED ones simply won't appear in the
    // response — we treat "sent but not returned" as DELETED.
    // Falls back silently to the logged state if Xero is unavailable.
    try {
      const invoiceXeroIds = entries
        .filter(e => e.xero_id && ['po_bill', 'so_invoice', 'eod_reconciliation', 'online_batch'].includes(e.sync_type))
        .map(e => e.xero_id as string);
      const uniqueIds = [...new Set(invoiceXeroIds)];

      if (uniqueIds.length > 0) {
        const liveStatus = new Map<string, string>(); // xeroId → Xero Status
        const BATCH = 100;
        for (let i = 0; i < uniqueIds.length; i += BATCH) {
          const chunk = uniqueIds.slice(i, i + BATCH);
          const result = await xeroApiFetch(
            databaseId!,
            `/Invoices?IDs=${chunk.join(',')}&unitdp=4`,
          );
          for (const inv of result?.Invoices ?? []) {
            if (inv.InvoiceID && inv.Status) liveStatus.set(inv.InvoiceID, inv.Status);
          }
        }

        // Apply live status — IDs we requested but Xero didn't return = DELETED
        const requestedSet = new Set(uniqueIds);
        for (const entry of entries) {
          if (!entry.xero_id) continue;
          if (!requestedSet.has(entry.xero_id)) continue;
          const live = liveStatus.get(entry.xero_id);
          entry.last_xero_state = live ?? 'DELETED';
        }
      }
    } catch {
      // Xero not connected or API error — leave last_xero_state as logged value
    }

    return NextResponse.json({ entries });
  } catch (err: any) {
    console.error('[xero/sync-log]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

