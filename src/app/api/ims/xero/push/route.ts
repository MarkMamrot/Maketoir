/**
 * POST /api/ims/xero/push
 * Body: { type: 'po' | 'so' | 'cn' | 'scn' | 'gift_card_issue' | 'gift_card_redeem' | 'store_credit_issue' | 'store_credit_redeem', id: number }
 * Re-triggers the Xero sync for a queued or failed order.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { triggerPOXeroSync, triggerSOXeroSync, triggerCNXeroSync, triggerSupplierCNXeroSync } from '@/lib/ims/xeroHooks';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import {
  syncGiftCardIssueInvoice,
  syncGiftCardRedemptionReclass,
  syncStoreCreditIssueReclass,
  syncStoreCreditRedemptionReclass,
} from '@/services/XeroSyncService';


export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;
  let lockKey: string | null = null;

  try {
    const { type, id } = await req.json() as {
      type: 'po' | 'so' | 'cn' | 'scn' | 'gift_card_issue' | 'gift_card_redeem' | 'store_credit_issue' | 'store_credit_redeem';
      id: number;
    };
    if (!type || !id) return NextResponse.json({ error: 'type and id required' }, { status: 400 });

    if (type === 'po') {
      // Determine current PO status so we know which sync to run
      const rows = await imsQuery<{ status: string }>(`SELECT status FROM ims_purchase_orders WHERE id = ?`, [id]);
      const status = rows[0]?.status ?? 'confirmed';
      const syncStatus = status === 'complete' ? 'complete' : 'confirmed';
      await triggerPOXeroSync(businessId, id, syncStatus);
    } else if (type === 'so') {
      await triggerSOXeroSync(businessId, id, 'confirmed');
    } else if (type === 'cn') {
      lockKey = `xero:push:${businessId}:cn:${id}`;
      const lockRows = await query<{ acquired: number }>(`SELECT GET_LOCK(?, 0) AS acquired`, [lockKey]);
      if (!Number(lockRows[0]?.acquired)) {
        return NextResponse.json({ error: 'Retry already in progress for this customer credit note.' }, { status: 409 });
      }
      const cnRows = await imsQuery<{ xero_sync_status: string | null; xero_credit_note_id: string | null }>(
        `SELECT xero_sync_status, xero_credit_note_id FROM ims_credit_notes WHERE id = ? LIMIT 1`,
        [id],
      );
      const cn = cnRows[0];
      if (cn?.xero_sync_status === 'synced' && cn?.xero_credit_note_id) {
        return NextResponse.json({ success: true, skipped: true, reason: 'already_synced' });
      }
      await triggerCNXeroSync(businessId, id);
    } else if (type === 'gift_card_issue') {
      const rows = await imsQuery<{ id: number; code: string; amount: string; issue_date: string | null }>(
        `SELECT id, code,
                COALESCE(initial_balance, balance) AS amount,
                DATE(created_at) AS issue_date
           FROM gift_cards
          WHERE id = ?
          LIMIT 1`,
        [id],
      );
      if (!rows[0]) return NextResponse.json({ error: 'Gift card issue record not found.' }, { status: 404 });
      const row = rows[0];
      await syncGiftCardIssueInvoice({
        businessId,
        amount: Number(row.amount ?? 0),
        issueDate: String(row.issue_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
        reference: `IMS-GC-${row.id}`,
        narration: `Gift card issued in IMS (${String(row.code ?? '').trim().toUpperCase()})`,
        dedupeKey: `gift card issue ims ${row.id}|${String(row.code ?? '').trim().toUpperCase()}|${Number(row.amount ?? 0).toFixed(2)}`,
        referenceId: row.id,
      });
    } else if (type === 'gift_card_redeem') {
      const rows = await imsQuery<{ id: number; amount: string; tx_date: string | null; location_id: number | null }>(
        `SELECT gct.id,
                ABS(gct.amount) AS amount,
                COALESCE(DATE(ps.completed_at), DATE(gct.created_at)) AS tx_date,
                ps.location_id
           FROM gift_card_transactions gct
           LEFT JOIN pos_sales ps ON ps.id = gct.pos_sale_id
          WHERE gct.id = ? AND gct.type = 'redeem'
          LIMIT 1`,
        [id],
      );
      if (!rows[0]) return NextResponse.json({ error: 'Gift card redemption transaction not found.' }, { status: 404 });
      const row = rows[0];
      await syncGiftCardRedemptionReclass({
        businessId,
        amount: Number(row.amount ?? 0),
        date: String(row.tx_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
        channel: 'pos',
        locationId: row.location_id ?? undefined,
        dedupeKey: `gift card redeem tx ${row.id}`,
        referenceId: row.id,
      });
    } else if (type === 'store_credit_issue' || type === 'store_credit_redeem') {
      const rows = await imsQuery<{ id: number; type: string; amount: string; tx_date: string | null; location_id: number | null }>(
        `SELECT sct.id,
                sct.type,
                ABS(sct.amount) AS amount,
                COALESCE(DATE(ps.completed_at), DATE(sct.created_at)) AS tx_date,
                ps.location_id
           FROM store_credit_transactions sct
           LEFT JOIN pos_sales ps ON ps.id = sct.pos_sale_id
          WHERE sct.id = ?
          LIMIT 1`,
        [id],
      );
      if (!rows[0]) return NextResponse.json({ error: 'Store credit transaction not found.' }, { status: 404 });
      const row = rows[0];
      const txType = String(row.type ?? '').toLowerCase();
      if (type === 'store_credit_issue' && txType !== 'issue') {
        return NextResponse.json({ error: `Transaction ${id} is not a store credit issue.` }, { status: 409 });
      }
      if (type === 'store_credit_redeem' && txType !== 'redeem') {
        return NextResponse.json({ error: `Transaction ${id} is not a store credit redemption.` }, { status: 409 });
      }
      const payload = {
        businessId,
        amount: Number(row.amount ?? 0),
        date: String(row.tx_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
        channel: 'pos' as const,
        locationId: row.location_id ?? undefined,
        dedupeKey: `store credit ${type === 'store_credit_issue' ? 'issue' : 'redeem'} tx ${row.id}`,
        referenceId: row.id,
      };
      if (type === 'store_credit_issue') await syncStoreCreditIssueReclass(payload);
      else await syncStoreCreditRedemptionReclass(payload);
    } else {
      lockKey = `xero:push:${businessId}:scn:${id}`;
      const lockRows = await query<{ acquired: number }>(`SELECT GET_LOCK(?, 0) AS acquired`, [lockKey]);
      if (!Number(lockRows[0]?.acquired)) {
        return NextResponse.json({ error: 'Retry already in progress for this supplier credit note.' }, { status: 409 });
      }
      const scnRows = await imsQuery<{ xero_sync_status: string | null; xero_credit_note_id: string | null }>(
        `SELECT xero_sync_status, xero_credit_note_id FROM ims_supplier_credit_notes WHERE id = ? LIMIT 1`,
        [id],
      );
      const scn = scnRows[0];
      if (scn?.xero_sync_status === 'synced' && scn?.xero_credit_note_id) {
        return NextResponse.json({ success: true, skipped: true, reason: 'already_synced' });
      }
      await triggerSupplierCNXeroSync(businessId, id);
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    if (lockKey) {
      try {
        await query(`SELECT RELEASE_LOCK(?)`, [lockKey]);
      } catch {
        // Non-critical; lock auto-releases when connection closes.
      }
    }
  }
}
