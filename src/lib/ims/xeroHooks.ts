/**
 * xeroHooks.ts — Fire-and-forget helpers called from IMS API routes
 * to trigger Xero syncing when POs/SOs change state.
 *
 * These are designed to be non-blocking — failures are logged to xero_sync_log
 * but do not break the main IMS operation.
 */

import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsPORepo, ImsSORepo } from '@/lib/ims/ImsRepository';
import { syncPOAsDraftBill, approveBill, syncPOReceivedJournal, syncPOPayment, syncSOAsInvoice } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

/**
 * Check if a business has Xero connected (quick check before doing any sync work).
 */
async function isXeroConnected(businessId: string): Promise<boolean> {
  const conn = await ConnectionsRepository.get(businessId);
  return !!(conn?.xero_tenant_id && conn?.xero_refresh_token);
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
    // Create or update Draft Bill
    await syncPOAsDraftBill(businessId, po as any);
  } else if (newStatus === 'received') {
    // Find existing synced bill
    const logRows = await query(
      `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [businessId, poId],
    );
    const xeroInvoiceId = logRows[0]?.xero_id;

    if (xeroInvoiceId) {
      // Approve the bill
      await approveBill(businessId, xeroInvoiceId, poId);

      // If there were deposits, post a transfer journal (In Transit → Inventory Asset)
      const hasDeposits = (po.payments?.length ?? 0) > 0;
      if (hasDeposits) {
        await syncPOReceivedJournal(businessId, poId, po.po_number, po.total_amount, po.location_id);
      }
    } else {
      // No bill exists yet — create one directly as approved
      const xeroId = await syncPOAsDraftBill(businessId, po as any);
      if (xeroId) {
        await approveBill(businessId, xeroId, poId);
      }
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

  // Find existing synced bill
  let logRows = await query(
    `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [businessId, poId],
  );

  let xeroInvoiceId = logRows[0]?.xero_id;

  // If no bill exists yet, create one
  if (!xeroInvoiceId) {
    xeroInvoiceId = await syncPOAsDraftBill(businessId, po as any);
  }

  if (!xeroInvoiceId) return;

  // Approve the bill (idempotent)
  await approveBill(businessId, xeroInvoiceId, poId);

  // Find the payment details
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

  await syncSOAsInvoice(businessId, so as any);
}
