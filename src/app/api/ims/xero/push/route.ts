/**
 * POST /api/ims/xero/push
 * Body: { type: 'po' | 'so' | 'cn' | 'scn' | 'gift_card_issue' | 'gift_card_redeem' | 'store_credit_issue' | 'store_credit_redeem', id: number }
 * Re-triggers the Xero sync for a queued or failed order.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { triggerPOXeroSync, triggerSOXeroSync, triggerCNXeroSync, triggerSupplierCNXeroSync, triggerPOPaymentXeroSync, triggerSOPaymentXeroSync } from '@/lib/ims/xeroHooks';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import {
  syncGiftCardIssueInvoice,
  syncGiftCardRedemptionReclass,
  syncStoreCreditIssueReclass,
  syncStoreCreditRedemptionReclass,
} from '@/services/XeroSyncService';

type InvoiceNumberConflict = {
  invoiceNumber: string;
  xeroId: string | null;
};

function parseInvoiceNumberConflict(detail: string, attemptedInvoiceNumber: string): InvoiceNumberConflict | null {
  const raw = String(detail || '');
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) return null;
  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    const element = Array.isArray(parsed?.Elements) ? parsed.Elements[0] : null;
    const invoiceNumber = String(element?.InvoiceNumber ?? '').trim();
    const validationMessages = Array.isArray(element?.ValidationErrors)
      ? element.ValidationErrors.map((entry: any) => String(entry?.Message ?? '')).join(' | ')
      : '';
    const isConflict = /not of valid status for modification|already been used|must be unique|duplicate/i.test(validationMessages);
    if (!isConflict || invoiceNumber.toLowerCase() !== attemptedInvoiceNumber.toLowerCase()) return null;
    return { invoiceNumber, xeroId: element?.InvoiceID ? String(element.InvoiceID) : null };
  } catch {
    return null;
  }
}

function normalizeInvoiceNumberSuffix(value: unknown): string | null {
  const trimmed = String(value ?? '').trim().toUpperCase();
  if (!trimmed) return null;
  const withDash = trimmed.startsWith('-') ? trimmed : `-${trimmed}`;
  return /^-[A-Z0-9]{1,10}$/.test(withDash) ? withDash : null;
}

function nextSuggestedSuffix(attemptedSuffix: string | null): string {
  if (!attemptedSuffix) return '-R';
  const match = attemptedSuffix.match(/^(.*?)(\d+)$/);
  return match ? `${match[1]}${Number(match[2]) + 1}` : `${attemptedSuffix}2`;
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  try {
    const { type, id, parentId, invoiceNumberSuffix } = await req.json() as {
      type: 'po' | 'so' | 'po_payment' | 'so_payment' | 'cn' | 'scn' | 'gift_card_issue' | 'gift_card_redeem' | 'store_credit_issue' | 'store_credit_redeem';
      id: number;
      parentId?: number;
      invoiceNumberSuffix?: string;
    };
    if (!type || !id) return NextResponse.json({ error: 'type and id required' }, { status: 400 });

    if (type === 'po') {
      // Determine current PO status so we know which sync to run
      const rows = await imsQuery<{ status: string; supplier_invoice_number: string | null }>(
        `SELECT status, supplier_invoice_number FROM ims_purchase_orders WHERE id = ?`,
        [id],
      );
      if (!rows[0]) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
      const status = rows[0]?.status ?? 'confirmed';
      const supplierInvoiceNumber = String(rows[0]?.supplier_invoice_number ?? '').trim();
      const normalizedSuffix = invoiceNumberSuffix === undefined ? null : normalizeInvoiceNumberSuffix(invoiceNumberSuffix);
      if (invoiceNumberSuffix !== undefined && !normalizedSuffix) {
        return NextResponse.json({ error: 'Suffix must contain 1-10 letters or numbers.' }, { status: 400 });
      }
      if (normalizedSuffix && !supplierInvoiceNumber) {
        return NextResponse.json({ error: 'This PO has no supplier invoice number to suffix.' }, { status: 409 });
      }
      const attemptedInvoiceNumber = normalizedSuffix
        ? `${supplierInvoiceNumber}${normalizedSuffix}`
        : supplierInvoiceNumber;
      const previousLogs = await query<{ id: number }>(
        `SELECT id FROM xero_sync_log
          WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ?
          ORDER BY id DESC LIMIT 1`,
        [businessId, id],
      );
      const previousLogId = Number(previousLogs[0]?.id ?? 0);
      const syncStatus = status === 'complete' ? 'complete' : 'confirmed';
      if (normalizedSuffix) {
        await triggerPOXeroSync(businessId, id, syncStatus, attemptedInvoiceNumber);
      } else {
        await triggerPOXeroSync(businessId, id, syncStatus);
      }
      const resultRows = await imsQuery<{ xero_sync_status: string | null; xero_bill_id: string | null }>(
        `SELECT xero_sync_status, xero_bill_id FROM ims_purchase_orders WHERE id = ? LIMIT 1`,
        [id],
      );
      const result = resultRows[0];
      const success = result?.xero_sync_status === 'synced' && !!result.xero_bill_id;
      if (!success && attemptedInvoiceNumber) {
        const latestLogs = await query<{ detail: string }>(
          `SELECT detail FROM xero_sync_log
            WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ? AND id > ? AND status = 'error'
            ORDER BY id DESC LIMIT 1`,
          [businessId, id, previousLogId],
        );
        const conflict = parseInvoiceNumberConflict(latestLogs[0]?.detail ?? '', attemptedInvoiceNumber);
        if (conflict) {
          const suggestedSuffix = nextSuggestedSuffix(normalizedSuffix);
          return NextResponse.json({
            success: false,
            status: result?.xero_sync_status ?? 'error',
            xeroId: null,
            recovery: {
              type: 'invoice_number_conflict',
              originalInvoiceNumber: supplierInvoiceNumber,
              attemptedInvoiceNumber,
              conflictingXeroId: conflict.xeroId,
              suggestedSuffix,
              suggestedInvoiceNumber: `${supplierInvoiceNumber}${suggestedSuffix}`,
            },
          });
        }
      }
      return NextResponse.json({
        success,
        status: result?.xero_sync_status ?? 'error',
        xeroId: result?.xero_bill_id ?? null,
      });
    } else if (type === 'so') {
      const rows = await imsQuery<{ status: string }>(`SELECT status FROM ims_sales_orders WHERE id = ?`, [id]);
      const status = rows[0]?.status ?? 'confirmed';
      await triggerSOXeroSync(businessId, id, status);
      const resultRows = await imsQuery<{ xero_sync_status: string | null; xero_invoice_id: string | null }>(
        `SELECT xero_sync_status, xero_invoice_id FROM ims_sales_orders WHERE id = ? LIMIT 1`,
        [id],
      );
      const result = resultRows[0];
      return NextResponse.json({
        success: result?.xero_sync_status === 'synced' && !!result.xero_invoice_id,
        status: result?.xero_sync_status ?? 'error',
        xeroId: result?.xero_invoice_id ?? null,
      });
    } else if (type === 'po_payment' || type === 'so_payment') {
      if (!parentId) return NextResponse.json({ error: 'parentId is required for payment replay.' }, { status: 400 });
      const table = type === 'po_payment' ? 'ims_purchase_order_payments' : 'ims_sales_order_payments';
      const parentColumn = type === 'po_payment' ? 'po_id' : 'so_id';
      const paymentRows = await imsQuery<{ id: number }>(
        `SELECT id FROM ${table} WHERE id = ? AND ${parentColumn} = ? LIMIT 1`,
        [id, parentId],
      );
      if (!paymentRows[0]) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
      if (type === 'po_payment') await triggerPOPaymentXeroSync(businessId, parentId, id);
      else await triggerSOPaymentXeroSync(businessId, parentId, id);
    } else if (type === 'cn') {
      const cnRows = await imsQuery<{ xero_sync_status: string | null; xero_credit_note_id: string | null }>(
        `SELECT xero_sync_status, xero_credit_note_id FROM ims_credit_notes WHERE id = ? LIMIT 1`,
        [id],
      );
      const cn = cnRows[0];
      if (cn?.xero_sync_status === 'synced' && cn?.xero_credit_note_id) {
        return NextResponse.json({ success: true, skipped: true, reason: 'already_synced' });
      }
      await triggerCNXeroSync(businessId, id);
      const resultRows = await imsQuery<{ xero_sync_status: string | null; xero_credit_note_id: string | null }>(
        `SELECT xero_sync_status, xero_credit_note_id FROM ims_credit_notes WHERE id = ? LIMIT 1`,
        [id],
      );
      const result = resultRows[0];
      return NextResponse.json({
        success: result?.xero_sync_status === 'synced' && !!result.xero_credit_note_id,
        status: result?.xero_sync_status ?? 'error',
        xeroId: result?.xero_credit_note_id ?? null,
      });
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
      const scnRows = await imsQuery<{ xero_sync_status: string | null; xero_credit_note_id: string | null }>(
        `SELECT xero_sync_status, xero_credit_note_id FROM ims_supplier_credit_notes WHERE id = ? LIMIT 1`,
        [id],
      );
      const scn = scnRows[0];
      if (scn?.xero_sync_status === 'synced' && scn?.xero_credit_note_id) {
        return NextResponse.json({ success: true, skipped: true, reason: 'already_synced' });
      }
      await triggerSupplierCNXeroSync(businessId, id);
      const resultRows = await imsQuery<{ xero_sync_status: string | null; xero_credit_note_id: string | null }>(
        `SELECT xero_sync_status, xero_credit_note_id FROM ims_supplier_credit_notes WHERE id = ? LIMIT 1`,
        [id],
      );
      const result = resultRows[0];
      return NextResponse.json({
        success: result?.xero_sync_status === 'synced' && !!result.xero_credit_note_id,
        status: result?.xero_sync_status ?? 'error',
        xeroId: result?.xero_credit_note_id ?? null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
