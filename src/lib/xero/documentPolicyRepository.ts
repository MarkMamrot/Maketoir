import { execute, query } from '@/services/MySQLService';
import {
  DEFAULT_XERO_DOCUMENT_POLICY,
  type XeroDocumentAction,
  type XeroDocumentPolicy,
} from './documentPolicies';

type XeroDocumentPolicyRow = {
  po_approved_action: XeroDocumentAction;
  po_completed_action: XeroDocumentAction;
  po_payment_sync_enabled: number | boolean;
  so_approved_action: XeroDocumentAction;
  so_completed_action: XeroDocumentAction;
  so_payment_sync_enabled: number | boolean;
  manual_customer_cn_action: XeroDocumentAction;
  supplier_cn_action: XeroDocumentAction;
  shortfall_credit_draft_first: number | boolean;
  pos_batch_sync_enabled: number | boolean;
  pos_batch_payment_sync_enabled: number | boolean;
  online_batch_action: XeroDocumentAction;
  online_batch_payment_sync_enabled: number | boolean;
  shopify_payout_auto_post_enabled: number | boolean;
};

export async function getXeroDocumentPolicy(businessId: string): Promise<XeroDocumentPolicy> {
  const rows = await query<XeroDocumentPolicyRow>(
    `SELECT po_approved_action, po_completed_action, po_payment_sync_enabled,
          so_approved_action, so_completed_action, so_payment_sync_enabled,
          manual_customer_cn_action, supplier_cn_action, shortfall_credit_draft_first,
          pos_batch_sync_enabled, pos_batch_payment_sync_enabled,
          online_batch_action, online_batch_payment_sync_enabled,
          shopify_payout_auto_post_enabled
       FROM xero_document_policies
      WHERE business_id = ?
      LIMIT 1`,
    [businessId],
  );
  const row = rows[0];
  if (!row) return { ...DEFAULT_XERO_DOCUMENT_POLICY };

  return {
    poApprovedAction: row.po_approved_action,
    poCompletedAction: row.po_completed_action,
    poPaymentSyncEnabled: Boolean(row.po_payment_sync_enabled),
    soApprovedAction: row.so_approved_action,
    soCompletedAction: row.so_completed_action,
    soPaymentSyncEnabled: Boolean(row.so_payment_sync_enabled),
    manualCustomerCreditNoteAction: row.manual_customer_cn_action ?? DEFAULT_XERO_DOCUMENT_POLICY.manualCustomerCreditNoteAction,
    supplierCreditNoteAction: row.supplier_cn_action ?? DEFAULT_XERO_DOCUMENT_POLICY.supplierCreditNoteAction,
    shortfallCreditDraftFirst: row.shortfall_credit_draft_first == null ? DEFAULT_XERO_DOCUMENT_POLICY.shortfallCreditDraftFirst : Boolean(row.shortfall_credit_draft_first),
    posBatchSyncEnabled: row.pos_batch_sync_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.posBatchSyncEnabled : Boolean(row.pos_batch_sync_enabled),
    posBatchPaymentSyncEnabled: row.pos_batch_payment_sync_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.posBatchPaymentSyncEnabled : Boolean(row.pos_batch_payment_sync_enabled),
    onlineBatchAction: row.online_batch_action ?? DEFAULT_XERO_DOCUMENT_POLICY.onlineBatchAction,
    onlineBatchPaymentSyncEnabled: row.online_batch_payment_sync_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.onlineBatchPaymentSyncEnabled : Boolean(row.online_batch_payment_sync_enabled),
    shopifyPayoutAutoPostEnabled: row.shopify_payout_auto_post_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.shopifyPayoutAutoPostEnabled : Boolean(row.shopify_payout_auto_post_enabled),
  };
}

export async function saveXeroDocumentPolicy(
  businessId: string,
  policy: XeroDocumentPolicy,
): Promise<void> {
  await execute(
    `INSERT INTO xero_document_policies
       (business_id, po_approved_action, po_completed_action, po_payment_sync_enabled,
        so_approved_action, so_completed_action, so_payment_sync_enabled,
        manual_customer_cn_action, supplier_cn_action, shortfall_credit_draft_first,
        pos_batch_sync_enabled, pos_batch_payment_sync_enabled,
        online_batch_action, online_batch_payment_sync_enabled, shopify_payout_auto_post_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       po_approved_action = VALUES(po_approved_action),
       po_completed_action = VALUES(po_completed_action),
       po_payment_sync_enabled = VALUES(po_payment_sync_enabled),
       so_approved_action = VALUES(so_approved_action),
       so_completed_action = VALUES(so_completed_action),
       so_payment_sync_enabled = VALUES(so_payment_sync_enabled),
      manual_customer_cn_action = VALUES(manual_customer_cn_action),
      supplier_cn_action = VALUES(supplier_cn_action),
      shortfall_credit_draft_first = VALUES(shortfall_credit_draft_first),
      pos_batch_sync_enabled = VALUES(pos_batch_sync_enabled),
      pos_batch_payment_sync_enabled = VALUES(pos_batch_payment_sync_enabled),
      online_batch_action = VALUES(online_batch_action),
      online_batch_payment_sync_enabled = VALUES(online_batch_payment_sync_enabled),
      shopify_payout_auto_post_enabled = VALUES(shopify_payout_auto_post_enabled),
       updated_at = NOW()`,
    [
      businessId,
      policy.poApprovedAction,
      policy.poCompletedAction,
      policy.poPaymentSyncEnabled ? 1 : 0,
      policy.soApprovedAction,
      policy.soCompletedAction,
      policy.soPaymentSyncEnabled ? 1 : 0,
      policy.manualCustomerCreditNoteAction,
      policy.supplierCreditNoteAction,
      policy.shortfallCreditDraftFirst ? 1 : 0,
      policy.posBatchSyncEnabled ? 1 : 0,
      policy.posBatchPaymentSyncEnabled ? 1 : 0,
      policy.onlineBatchAction,
      policy.onlineBatchPaymentSyncEnabled ? 1 : 0,
      policy.shopifyPayoutAutoPostEnabled ? 1 : 0,
    ],
  );
}