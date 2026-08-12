/**
 * xeroHooks.ts — Fire-and-forget helpers called from IMS API routes
 * to trigger Xero syncing when POs/SOs change state.
 *
 * These are designed to be non-blocking — failures are logged to xero_sync_log
 * but do not break the main IMS operation.
 */

import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsPORepo, ImsSORepo, ImsCNRepo, ImsSupplierCNRepo } from '@/lib/ims/ImsRepository';
import { isOrderXeroEligible } from '@/lib/ims/backorders/domain';
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';
import { allocateReservedCustomerCredit, allocateReservedSupplierCredit } from '@/lib/ims/orderResolution/reservedCreditAllocation';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { resolvePODocumentAction, resolveSODocumentAction } from '@/lib/xero/documentPolicies';
import { getXeroDocumentPolicy } from '@/lib/xero/documentPolicyRepository';
import { syncPOAsDraftBill, syncPOAttachmentsToXero, updateXeroDraftBill, approveBill, syncPOReceivedJournal, syncPOPayment, syncSOPayment, syncSOAsInvoice, updateXeroDraftInvoice, approveInvoice, markPoXeroStatus, markSoXeroStatus, voidXeroBill, voidXeroInvoice, syncCNAsCreditNote, markCNXeroStatus, syncSupplierCNAsCreditNote, markSupplierCNXeroStatus, voidXeroCreditNote, voidXeroSupplierCreditNote, updateXeroDraftCustomerCreditNote, updateXeroDraftSupplierCreditNote, approveCreditNote } from '@/services/XeroSyncService';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';

/**
 * Check if a business has Xero connected (quick check before doing any sync work).
 */
async function isXeroConnected(businessId: string): Promise<boolean> {
  const conn = await ConnectionsRepository.get(businessId);
  return !!(conn?.xero_tenant_id && conn?.xero_refresh_token);
}

async function loadDocumentPolicy(businessId: string) {
  try {
    return await getXeroDocumentPolicy(businessId);
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'XeroHooks',
      operation: 'load_document_policy',
      title: 'Xero sync skipped because document policy could not be loaded',
      error,
    });
    return null;
  }
}

/** Retry a sync function once after 2s. Marks as queued if both attempts fail. */
async function withRetry<T>(
  fn: () => Promise<T | null>,
  onQueued: () => Promise<void>,
  onFinalFailure?: (error: unknown) => Promise<void>,
): Promise<T | null> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await fn();
      if (result !== null) return result;
      if (lastError == null) {
        lastError = new Error('Sync returned no result');
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  await onQueued();
  if (onFinalFailure) {
    await onFinalFailure(lastError);
  }
  return null;
}

async function notifyXeroFinalFailure(
  businessId: string,
  syncTypeLabel: string,
  reference: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error ?? 'Xero sync failed after retry');
  await notifySyncFailure({
    businessId,
    source: 'xero_sync',
    title: `Xero Sync Failed — ${syncTypeLabel}`,
    message: `${reference} failed after retry. ${message}`,
    detail: { sync_type: syncTypeLabel, reference, error: message },
    dedupeKey: `xero:${syncTypeLabel}:${reference}`,
    dedupeMinutes: 60,
  }).catch(() => {});
}

/**
 * Triggered when a PO status changes.
 * - draft → approved: Create Draft Bill in Xero
 * - approved → received (no deposits): Approve the Bill directly
 * - approved → received (with deposits): Approve Bill + post received journal
 */
export async function triggerPOXeroSync(
  businessId: string,
  poId: number,
  newStatus: string,
  supplierInvoiceNumberOverride?: string,
): Promise<void> {
  if (!isOrderXeroEligible(newStatus)) return;
  if (!await isXeroConnected(businessId)) return;

  const policy = await loadDocumentPolicy(businessId);
  if (!policy) return;
  const action = resolvePODocumentAction(policy, newStatus);
  if (action === 'none') return;

  const po = await ImsPORepo.get(poId, businessId);
  if (!po || !isOrderXeroEligible(String((po as any).status ?? newStatus))) return;
  const poForSync = supplierInvoiceNumberOverride
    ? { ...po, supplier_invoice_number: supplierInvoiceNumberOverride }
    : po;

  const storedXeroId = (po as any).xero_bill_id ?? null;
  const logRows = storedXeroId ? [] : await query(
    `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [businessId, poId],
  );
  let xeroInvoiceId = storedXeroId ?? logRows[0]?.xero_id ?? null;

  if (xeroInvoiceId) {
    await updateXeroDraftBill(businessId, poForSync as any, xeroInvoiceId);
  } else {
    xeroInvoiceId = await withRetry(
      () => syncPOAsDraftBill(businessId, poForSync as any),
      () => markPoXeroStatus(poId, 'queued'),
      (error) => notifyXeroFinalFailure(businessId, 'PO Bill', `PO ${po.po_number}`, error),
    );
  }
  if (!xeroInvoiceId) return;

  await syncPOAttachmentsToXero(businessId, poId, po.po_number, xeroInvoiceId);
  if (action !== 'authorised') return;

  const approved = await approveBill(businessId, xeroInvoiceId, poId);
  if (approved) await allocateReservedSupplierCredit(businessId, poId);
  if (approved && newStatus === 'complete' && (po.payments?.length ?? 0) > 0) {
    await syncPOReceivedJournal(businessId, poId, po.po_number, xeroInvoiceId, po.total_amount, po.location_id);
  }
}

/**
 * Triggered when a PO's fields/items are edited without a status change.
 * Updates the existing eligible Xero Bill if one exists.
 */
export async function triggerPOXeroUpdate(businessId: string, poId: number): Promise<{ attempted: boolean; updated: boolean; warning: string | null }> {
  try {
    if (!await isXeroConnected(businessId)) return { attempted: false, updated: false, warning: null };
    const po = await ImsPORepo.get(poId, businessId);
    if (!po || !isOrderXeroEligible(String((po as any).status ?? ''))) return { attempted: false, updated: false, warning: null };
    const xeroId = (po as any).xero_bill_id ?? null;
    if (!xeroId) return { attempted: false, updated: false, warning: null };
    const updated = await updateXeroDraftBill(businessId, po as any, xeroId);
    return {
      attempted: true,
      updated,
      warning: updated ? null : `Purchase order ${(po as any).po_number} was saved, but its linked Xero bill could not be updated.`,
    };
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'XeroHooks',
      operation: 'update_po_bill_after_edit',
      title: 'Purchase order was saved but its Xero bill update failed',
      error,
      reference: { type: 'purchase_order', id: poId },
    }).catch(() => {});
    return { attempted: true, updated: false, warning: `Purchase order ${poId} was saved, but Xero could not be updated right now.` };
  }
}

/**
 * Triggered when a payment is added to a PO.
 * Approves the Bill (if not already) and records the payment in Xero.
 */
export async function triggerPOPaymentXeroSync(businessId: string, poId: number, paymentId: number): Promise<void> {
  if (!await isXeroConnected(businessId)) return;
  const policy = await loadDocumentPolicy(businessId);
  if (!policy) return;
  if (!policy.poPaymentSyncEnabled) return;

  const po = await ImsPORepo.get(poId, businessId);
  if (!po || !isOrderXeroEligible(String((po as any).status ?? ''))) return;

  const payment = (po as any).payments?.find((candidate: any) => candidate.id === paymentId);
  if (!payment?.payment_method_id) return;
  const [method] = await imsQuery<{ xero_account_code: string }>(
    'SELECT xero_account_code FROM ims_payment_methods WHERE id = ?',
    [payment.payment_method_id],
  );
  if (!method?.xero_account_code) return;

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
      (error) => notifyXeroFinalFailure(businessId, 'PO Bill', `PO ${po.po_number}`, error),
    );
  }

  if (!xeroInvoiceId) return;

  await updateXeroDraftBill(businessId, po as any, xeroInvoiceId);
  const approved = await approveBill(businessId, xeroInvoiceId, poId);
  if (!approved) return;

  await syncPOPayment(businessId, xeroInvoiceId, poId, paymentId, payment.amount, payment.payment_date, payment.currency_code || 'AUD', method.xero_account_code);
}

/**
 * Triggered when a payment is added to an SO.
 * Ensures invoice exists and is approved, then records the payment in Xero.
 */
export async function triggerSOPaymentXeroSync(businessId: string, soId: number, paymentId: number): Promise<void> {
  if (!await isXeroConnected(businessId)) return;
  const policy = await loadDocumentPolicy(businessId);
  if (!policy) return;
  if (!policy.soPaymentSyncEnabled) return;

  const so = await ImsSORepo.get(soId, businessId);
  if (!so || !isOrderXeroEligible(String((so as any).status ?? ''))) return;

  const payment = (so as any).payments?.find((p: any) => p.id === paymentId);
  if (!payment) return;
  // Skip Xero payment sync if no payment method is set
  if (!payment.payment_method_id) return;
  const [method] = await imsQuery<{ xero_account_code: string }>(
    'SELECT xero_account_code FROM ims_payment_methods WHERE id = ?',
    [payment.payment_method_id],
  );
  if (!method?.xero_account_code) return;

  // Ensure invoice exists (and is approved) before applying payment
  let xeroInvoiceId = (so as any).xero_invoice_id ?? null;
  if (!xeroInvoiceId) {
    xeroInvoiceId = await withRetry(
      () => syncSOAsInvoice(businessId, so as any),
      () => markSoXeroStatus(Number(soId), 'queued'),
      (error) => notifyXeroFinalFailure(businessId, 'Sales Invoice', `SO ${so.so_number}`, error),
    );
  }
  if (!xeroInvoiceId) return;
  await updateXeroDraftInvoice(businessId, so as any, xeroInvoiceId);
  const approved = await approveInvoice(businessId, xeroInvoiceId, Number(soId));
  if (!approved) return;

  await syncSOPayment(businessId, xeroInvoiceId, soId, paymentId, payment.amount, payment.payment_date, payment.currency_code || 'AUD', method.xero_account_code);
}

/**
 * Triggered when a SO status changes.
 * - confirmed: Create Xero Invoice (wholesale orders only)
 */
export async function triggerSOXeroSync(businessId: string, soId: number, newStatus: string): Promise<void> {
  if (!isOrderXeroEligible(newStatus)) return;
  if (!await isXeroConnected(businessId)) return;

  const policy = await loadDocumentPolicy(businessId);
  if (!policy) return;
  const action = resolveSODocumentAction(policy, newStatus);
  if (action === 'none') return;

  const so = await ImsSORepo.get(soId, businessId);
  if (!so || !isOrderXeroEligible(String((so as any).status ?? newStatus))) return;
  let xeroInvoiceId = (so as any).xero_invoice_id ?? null;
  if (xeroInvoiceId) {
    await updateXeroDraftInvoice(businessId, so as any, xeroInvoiceId);
  } else {
    xeroInvoiceId = await withRetry(
      () => syncSOAsInvoice(businessId, so as any),
      () => markSoXeroStatus(Number(soId), 'queued'),
      (error) => notifyXeroFinalFailure(businessId, 'Sales Invoice', `SO ${so.so_number}`, error),
    );
  }
  if (xeroInvoiceId && action === 'authorised') {
    const approved = await approveInvoice(businessId, xeroInvoiceId, Number(soId));
    if (approved) await allocateReservedCustomerCredit(businessId, soId);
  }
}

/**
 * Triggered when a SO's fields/items are edited without a status change.
 * Updates the existing eligible Xero Invoice if one exists.
 */
export async function triggerSOXeroUpdate(businessId: string, soId: number): Promise<{ attempted: boolean; updated: boolean; warning: string | null }> {
  try {
    if (!await isXeroConnected(businessId)) return { attempted: false, updated: false, warning: null };
    const so = await ImsSORepo.get(soId, businessId);
    if (!so || !isOrderXeroEligible(String((so as any).status ?? ''))) return { attempted: false, updated: false, warning: null };
    const xeroId = (so as any).xero_invoice_id ?? null;
    if (!xeroId) return { attempted: false, updated: false, warning: null };
    const updated = await updateXeroDraftInvoice(businessId, so as any, xeroId);
    return {
      attempted: true,
      updated,
      warning: updated ? null : `Sales order ${(so as any).so_number} was saved, but its linked Xero invoice could not be updated.`,
    };
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'XeroHooks',
      operation: 'update_so_invoice_after_edit',
      title: 'Sales order was saved but its Xero invoice update failed',
      error,
      reference: { type: 'sales_order', id: soId },
    }).catch(() => {});
    return { attempted: true, updated: false, warning: `Sales order ${soId} was saved, but Xero could not be updated right now.` };
  }
}

/**
 * Triggered when a customer credit note's fields/items are edited without a status change.
 */
export async function triggerCNXeroUpdate(businessId: string, cnId: number): Promise<{ attempted: boolean; updated: boolean; warning: string | null }> {
  try {
    if (!await isXeroConnected(businessId)) return { attempted: false, updated: false, warning: null };
    const cn = await ImsCNRepo.get(cnId, businessId);
    if (!cn || cn.status !== 'draft') return { attempted: false, updated: false, warning: null };
    const xeroId = (cn as any).xero_credit_note_id ?? null;
    if (!xeroId) return { attempted: false, updated: false, warning: null };
    const updated = await updateXeroDraftCustomerCreditNote(businessId, cn as any, xeroId);
    return {
      attempted: true,
      updated,
      warning: updated ? null : `Customer credit note ${(cn as any).cn_number} was saved, but its linked Xero credit note could not be updated.`,
    };
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'XeroHooks',
      operation: 'update_customer_credit_note_after_edit',
      title: 'Customer credit note was saved but its Xero update failed',
      error,
      reference: { type: 'credit_note', id: cnId },
    }).catch(() => {});
    return { attempted: true, updated: false, warning: `Customer credit note ${cnId} was saved, but Xero could not be updated right now.` };
  }
}

/**
 * Triggered when a supplier credit note's fields/items are edited without a status change.
 */
export async function triggerSupplierCNXeroUpdate(businessId: string, scnId: number): Promise<{ attempted: boolean; updated: boolean; warning: string | null }> {
  try {
    if (!await isXeroConnected(businessId)) return { attempted: false, updated: false, warning: null };
    const scn = await ImsSupplierCNRepo.get(scnId, businessId);
    if (!scn || scn.status !== 'draft') return { attempted: false, updated: false, warning: null };
    const xeroId = (scn as any).xero_credit_note_id ?? null;
    if (!xeroId) return { attempted: false, updated: false, warning: null };
    const updated = await updateXeroDraftSupplierCreditNote(businessId, scn as any, xeroId);
    return {
      attempted: true,
      updated,
      warning: updated ? null : `Supplier credit note ${(scn as any).scn_number} was saved, but its linked Xero credit note could not be updated.`,
    };
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'XeroHooks',
      operation: 'update_supplier_credit_note_after_edit',
      title: 'Supplier credit note was saved but its Xero update failed',
      error,
      reference: { type: 'supplier_credit_note', id: scnId },
    }).catch(() => {});
    return { attempted: true, updated: false, warning: `Supplier credit note ${scnId} was saved, but Xero could not be updated right now.` };
  }
}

/**
 * Triggered when a PO is reverted (approved → draft) or cancelled.
 * Voids the Xero Draft Bill if one exists.
 * Non-blocking — returns a human-readable warning string if the void failed, null if successful or no bill existed.
 */
export async function triggerPOXeroVoid(businessId: string, poId: number): Promise<string | null> {
  if (!await isXeroConnected(businessId)) return null;

  const po = await ImsPORepo.get(poId, businessId);
  if (!po) return null;

  // Prefer stored xero_bill_id, fall back to sync_log
  const storedXeroId = (po as any).xero_bill_id ?? null;
  let xeroInvoiceId = storedXeroId;
  if (!xeroInvoiceId) {
    const logRows = await query(
      `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'po_bill' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [businessId, poId],
    );
    xeroInvoiceId = logRows[0]?.xero_id ?? null;
  }

  if (!xeroInvoiceId) return null; // No Xero bill was ever created — nothing to void

  const voided = await voidXeroBill(businessId, xeroInvoiceId, poId);
  if (!voided) {
    return `The Xero bill for PO ${(po as any).po_number} could not be voided automatically. Please void it manually in Xero.`;
  }
  // Clear the stored bill ID so it isn't re-used
  await markPoXeroStatus(poId, 'synced', null);
  return null;
}

/**
 * Triggered when an SO is reverted (confirmed → draft) or cancelled.
 * Voids the Xero Invoice if no payments have been applied.
 * Returns a warning string if a manual Xero action is needed, null otherwise.
 */
export async function triggerSOXeroVoid(businessId: string, soId: number): Promise<string | null> {
  if (!await isXeroConnected(businessId)) return null;

  const so = await ImsSORepo.get(soId, businessId);
  if (!so) return null;

  const storedXeroId = (so as any).xero_invoice_id ?? null;
  let xeroInvoiceId = storedXeroId;
  if (!xeroInvoiceId) {
    const logRows = await query(
      `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'so_invoice' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [businessId, soId],
    );
    xeroInvoiceId = logRows[0]?.xero_id ?? null;
  }

  if (!xeroInvoiceId) return null; // No Xero invoice was ever created — nothing to void

  const result = await voidXeroInvoice(businessId, xeroInvoiceId, soId);
  if (result.hasPayments) {
    return `⚠ The Xero invoice for SO ${(so as any).so_number} has payments applied and cannot be voided automatically. You must manually void or raise a credit note against it in Xero to keep your accounts accurate.`;
  }
  if (!result.voided) {
    return `The Xero invoice for SO ${(so as any).so_number} could not be voided automatically. Please void it manually in Xero.`;
  }
  // Clear the stored invoice ID
  await markSoXeroStatus(Number(soId), 'synced', null);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit Note hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync a completed Credit Note to Xero as an AUTHORISED ACCREC Credit Note.
 * Fire-and-forget — called after CN.complete().
 */
export async function triggerCNXeroSync(businessId: string, cnId: number): Promise<void> {
  const cn = await ImsCNRepo.get(cnId, businessId);
  if (!cn || cn.status !== 'complete' || cn.source === 'pos') return;
  if (!(await isXeroConnected(businessId))) return;

  const policy = await loadDocumentPolicy(businessId);
  if (!policy) return;
  const action = cn.source === 'shopify' ? 'authorised' : policy.manualCustomerCreditNoteAction;
  if (action === 'none') return;

  const existingXeroId = (cn as any).xero_credit_note_id ?? null;
  if (existingXeroId) {
    if (action === 'authorised') {
      await approveCreditNote(businessId, existingXeroId, cnId, 'cn_credit_note');
    }
    return;
  }

  await withRetry(
    () => syncCNAsCreditNote(businessId, {
      id: cn.id,
      cn_number: cn.cn_number,
      customer_id: cn.customer_id,
      customer_name: cn.customer_name,
      location_id: cn.location_id,
      cn_date: cn.cn_date,
      reference: cn.reference,
      tax_treatment: cn.tax_treatment,
      total_amount: cn.total_amount,
      items: (cn.items ?? []).map(i => ({
        code: i.code,
        name: i.name ?? i.product_name,
        qty: i.qty,
        unit_price: i.unit_price,
        tax_rate: i.tax_rate,
        line_total: i.line_total,
      })),
    }, action === 'draft' ? 'DRAFT' : 'AUTHORISED'),
    () => markCNXeroStatus(cnId, 'queued'),
    (error) => notifyXeroFinalFailure(businessId, 'Credit Note', `CN ${cn.cn_number}`, error),
  );
}
/** Triggered when a supplier credit note is completed → post ACCPAY credit note. */
export async function triggerSupplierCNXeroSync(businessId: string, scnId: number): Promise<void> {
  if (!(await isXeroConnected(businessId))) return;
  const scn = await ImsSupplierCNRepo.get(scnId, businessId);
  if (!scn || scn.status !== 'complete') return;

  const policy = await loadDocumentPolicy(businessId);
  if (!policy || policy.supplierCreditNoteAction === 'none') return;

  const payload = {
    id: scn.id,
    scn_number: scn.scn_number,
    supplier_id: scn.supplier_id,
    supplier_name: scn.supplier_name,
    location_id: scn.location_id,
    scn_date: scn.scn_date,
    reference: scn.reference,
    supplier_credit_ref: scn.supplier_credit_ref,
    tax_treatment: scn.tax_treatment,
    total_amount: scn.total_amount,
    items: (scn.items ?? []).map(i => ({
      code: i.code,
      name: i.name ?? i.product_name,
      qty: i.qty,
      unit_cost: i.unit_cost,
      restock: i.restock,
      tax_rate: i.tax_rate,
      line_total: i.line_total,
    })),
  };
  let xeroId = (scn as any).xero_credit_note_id ?? null;
  if (xeroId) {
    await updateXeroDraftSupplierCreditNote(businessId, payload, xeroId);
  } else {
    xeroId = await withRetry(
      () => syncSupplierCNAsCreditNote(businessId, payload),
      () => markSupplierCNXeroStatus(scnId, 'queued'),
      (error) => notifyXeroFinalFailure(businessId, 'Supplier Credit Note', `SCN ${scn.scn_number}`, error),
    );
  }
  if (xeroId && policy.supplierCreditNoteAction === 'authorised') {
    await approveCreditNote(businessId, xeroId, scnId, 'scn_credit_note');
  }
}

export async function resolveCNXeroCreditNoteId(businessId: string, cnId: number): Promise<string | null> {
  const cn = await ImsCNRepo.get(cnId, businessId);
  if (!cn) return null;
  const storedXeroId = (cn as any).xero_credit_note_id ?? null;
  if (storedXeroId) return storedXeroId;
  const logRows = await query(
    `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'cn_credit_note' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [businessId, cnId],
  );
  return logRows[0]?.xero_id ?? null;
}

export async function triggerCNXeroVoid(businessId: string, cnId: number): Promise<string | null> {
  if (!(await isXeroConnected(businessId))) return null;

  const cn = await ImsCNRepo.get(cnId, businessId);
  if (!cn) return null;
  const xeroCreditNoteId = await resolveCNXeroCreditNoteId(businessId, cnId);

  if (!xeroCreditNoteId) return null;

  const voided = await voidXeroCreditNote(businessId, xeroCreditNoteId, cnId);
  if (!voided) {
    return `The Xero credit note for CN ${(cn as any).cn_number} could not be voided automatically. Please void it manually in Xero.`;
  }
  return null;
}

export async function resolveSupplierCNXeroCreditNoteId(businessId: string, scnId: number): Promise<string | null> {
  const scn = await ImsSupplierCNRepo.get(scnId, businessId);
  if (!scn) return null;
  const storedXeroId = (scn as any).xero_credit_note_id ?? null;
  if (storedXeroId) return storedXeroId;
  const logRows = await query(
    `SELECT xero_id FROM xero_sync_log WHERE business_id = ? AND sync_type = 'scn_credit_note' AND reference_id = ? AND status = 'success' AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [businessId, scnId],
  );
  return logRows[0]?.xero_id ?? null;
}

export async function triggerSupplierCNXeroVoid(businessId: string, scnId: number): Promise<string | null> {
  if (!(await isXeroConnected(businessId))) return null;

  const scn = await ImsSupplierCNRepo.get(scnId, businessId);
  if (!scn) return null;
  const xeroCreditNoteId = await resolveSupplierCNXeroCreditNoteId(businessId, scnId);

  if (!xeroCreditNoteId) return null;

  const voided = await voidXeroSupplierCreditNote(businessId, xeroCreditNoteId, scnId);
  if (!voided) {
    return `The Xero supplier credit note for SCN ${(scn as any).scn_number} could not be voided automatically. Please void it manually in Xero.`;
  }
  return null;
}