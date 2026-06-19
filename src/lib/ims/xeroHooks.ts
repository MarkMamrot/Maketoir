/**
 * xeroHooks.ts — Fire-and-forget helpers called from IMS API routes
 * to trigger Xero syncing when POs/SOs change state.
 *
 * These are designed to be non-blocking — failures are logged to xero_sync_log
 * but do not break the main IMS operation.
 */

import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsPORepo, ImsSORepo } from '@/lib/ims/ImsRepository';
import { syncPOAsDraftBill, approveBill, syncPOReceivedJournal, syncPOPayment, syncSOAsInvoice, markPoXeroStatus, markSoXeroStatus } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

/**
 * Check if a business has Xero connected (quick check before doing any sync work).
 */
async function isXeroConnected(businessId: string): Promise<boolean> {
  const conn = await ConnectionsRepository.get(businessId);
  return !!(conn?.xero_tenant_id && conn?.xero_refresh_token);
}

/** Retry a sync function once after 2s. Marks as queued if both attempts fail. */
async function withRetry<T>(
  fn: () => Promise<T | null>,
  onQueued: () => Promise<void>,
): Promise<T | null> {
  const first = await fn();
  if (first !== null) return first;
  await new Promise(r => setTimeout(r, 2000));
  const second = await fn();
  if (second !== null) return second;
  await onQueued();
  return null;
}

/**
 * Triggered when a PO status changes.
 * - draft → approved: Create Draft Bill in Xero
 * - approved → received (no deposits): Approve the Bill directly
 * - approved → received (with deposits): Approve Bill + post received journal
 */
export async function triggerPOXeroSync(businessId: string, poId: number, newStatus: string): Promise<void> {
  if (!await isXeroConnected(businessId)) return;

  const po = await ImsPORepo.get(poId);
  if (!po) return;

  if (newStatus === 'approved') {
    // Create Draft Bill — retry once on failure, then mark as queued
    await withRetry(
      () => syncPOAsDraftBill(businessId, po as any),
      () => markPoXeroStatus(poId, 'queued'),
    );
  } else if (newStatus === 'received') {
    // Prefer the stored xero_bill_id, fall back to sync_log lookup
    const storedXeroId = (po as any).xero_bill_id ?? null;
    const logRows = storedXeroId ? [] : await query(
      `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [businessId, poId],
    );
    const xeroInvoiceId = storedXeroId ?? logRows[0]?.xero_id;

    if (xeroInvoiceId) {
      await approveBill(businessId, xeroInvoiceId, poId);
      const hasDeposits = (po.payments?.length ?? 0) > 0;
      if (hasDeposits) {
        await syncPOReceivedJournal(businessId, poId, po.po_number, po.total_amount, po.location_id);
      }
    } else {
      // No bill exists yet — create then approve, retry once on failure
      const xeroId = await withRetry(
        () => syncPOAsDraftBill(businessId, po as any),
        () => markPoXeroStatus(poId, 'queued'),
      );
      if (xeroId) await approveBill(businessId, xeroId, poId);
    }
  }
}

/**
 * Triggered when a payment is added to a PO.
 * Approves the Bill (if not already) and records the payment in Xero.
 */
export async function triggerPOPaymentXeroSync(businessId: string, poId: number, paymentId: number): Promise<void> {
  if (!await isXeroConnected(businessId)) return;

  const po = await ImsPORepo.get(poId);
  if (!po) return;

  // Prefer stored xero_bill_id, fall back to sync_log
  const storedXeroId = (po as any).xero_bill_id ?? null;
  let logRows = storedXeroId ? [] : await query(
    `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [businessId, poId],
  );
  let xeroInvoiceId = storedXeroId ?? logRows[0]?.xero_id;

  // If no bill exists yet, create one (with retry)
  if (!xeroInvoiceId) {
    xeroInvoiceId = await withRetry(
      () => syncPOAsDraftBill(businessId, po as any),
      () => markPoXeroStatus(poId, 'queued'),
    );
  }

  if (!xeroInvoiceId) return;

  await approveBill(businessId, xeroInvoiceId, poId);

  const payment = po.payments?.find((p: any) => p.id === paymentId);
  if (payment) {
    await syncPOPayment(businessId, xeroInvoiceId, poId, payment.amount, payment.payment_date, payment.currency_code || 'AUD');
  }
}

/**
 * Triggered when a SO status changes.
 * - confirmed: Create Xero Invoice (wholesale orders only)
 */
export async function triggerSOXeroSync(businessId: string, soId: number, newStatus: string): Promise<void> {
  if (!await isXeroConnected(businessId)) return;

  // Only sync on confirmed (invoice creation point)
  if (newStatus !== 'confirmed') return;

  const so = await ImsSORepo.get(soId);
  if (!so) return;

  await withRetry(
    () => syncSOAsInvoice(businessId, so as any),
    () => markSoXeroStatus(Number(soId), 'queued'),
  );
}
