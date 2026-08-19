import { getPool, query } from '@/services/MySQLService';
import {
  DEFAULT_XERO_DOCUMENT_POLICY,
  diffXeroDocumentPolicy,
  type XeroDocumentAction,
  type XeroDocumentPolicy,
} from './documentPolicies';

type XeroDocumentPolicyRow = {
  posting_enabled: number | boolean;
  po_approved_action: XeroDocumentAction;
  po_completed_action: XeroDocumentAction;
  po_payment_sync_enabled: number | boolean;
  po_receipt_journal_enabled: number | boolean;
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
  shopify_refund_cn_enabled: number | boolean;
  shopify_payout_posting_enabled: number | boolean;
  shopify_payout_auto_post_enabled: number | boolean;
  pos_cash_banking_enabled: number | boolean;
  stocktake_journal_enabled: number | boolean;
  gift_card_accounting_enabled: number | boolean;
  store_credit_accounting_enabled: number | boolean;
};

function policyFromRow(row: XeroDocumentPolicyRow | undefined): XeroDocumentPolicy {
  if (!row) return { ...DEFAULT_XERO_DOCUMENT_POLICY };
  return {
    postingEnabled: row.posting_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.postingEnabled : Boolean(row.posting_enabled),
    poApprovedAction: row.po_approved_action,
    poCompletedAction: row.po_completed_action,
    poPaymentSyncEnabled: Boolean(row.po_payment_sync_enabled),
    poReceiptJournalEnabled: row.po_receipt_journal_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.poReceiptJournalEnabled : Boolean(row.po_receipt_journal_enabled),
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
    shopifyRefundCreditNoteEnabled: row.shopify_refund_cn_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.shopifyRefundCreditNoteEnabled : Boolean(row.shopify_refund_cn_enabled),
    shopifyPayoutPostingEnabled: row.shopify_payout_posting_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.shopifyPayoutPostingEnabled : Boolean(row.shopify_payout_posting_enabled),
    shopifyPayoutAutoPostEnabled: row.shopify_payout_auto_post_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.shopifyPayoutAutoPostEnabled : Boolean(row.shopify_payout_auto_post_enabled),
    posCashBankingEnabled: row.pos_cash_banking_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.posCashBankingEnabled : Boolean(row.pos_cash_banking_enabled),
    stocktakeJournalEnabled: row.stocktake_journal_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.stocktakeJournalEnabled : Boolean(row.stocktake_journal_enabled),
    giftCardAccountingEnabled: row.gift_card_accounting_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.giftCardAccountingEnabled : Boolean(row.gift_card_accounting_enabled),
    storeCreditAccountingEnabled: row.store_credit_accounting_enabled == null ? DEFAULT_XERO_DOCUMENT_POLICY.storeCreditAccountingEnabled : Boolean(row.store_credit_accounting_enabled),
  };
}

const POLICY_SELECT = `SELECT posting_enabled, po_approved_action, po_completed_action, po_payment_sync_enabled, po_receipt_journal_enabled,
          so_approved_action, so_completed_action, so_payment_sync_enabled,
          manual_customer_cn_action, supplier_cn_action, shortfall_credit_draft_first,
          pos_batch_sync_enabled, pos_batch_payment_sync_enabled,
          online_batch_action, online_batch_payment_sync_enabled,
          shopify_refund_cn_enabled, shopify_payout_posting_enabled, shopify_payout_auto_post_enabled,
          pos_cash_banking_enabled, stocktake_journal_enabled,
          gift_card_accounting_enabled, store_credit_accounting_enabled
       FROM xero_document_policies
      WHERE business_id = ?`;

export async function getXeroDocumentPolicy(businessId: string): Promise<XeroDocumentPolicy> {
  const rows = await query<XeroDocumentPolicyRow>(
    `${POLICY_SELECT} LIMIT 1`,
    [businessId],
  );
  return policyFromRow(rows[0]);
}

export async function ensurePausedXeroDocumentPolicy(businessId: string): Promise<void> {
  await query(
    `INSERT IGNORE INTO xero_document_policies (business_id, posting_enabled)
     VALUES (?, 0)`,
    [businessId],
  );
}

export async function saveXeroDocumentPolicy(
  input: {
    businessId: string;
    policy: XeroDocumentPolicy;
    actorId?: string | number | null;
    actorName?: string | null;
    presetSource?: string | null;
  },
): Promise<{ before: XeroDocumentPolicy; changedFields: ReturnType<typeof diffXeroDocumentPolicy> }> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(`${POLICY_SELECT} LIMIT 1 FOR UPDATE`, [input.businessId]);
    const before = policyFromRow(rows[0]);
    const changedFields = diffXeroDocumentPolicy(before, input.policy);
    if (changedFields.length === 0) {
      await connection.rollback();
      return { before, changedFields };
    }
    await connection.execute(
     `INSERT INTO xero_document_policies
       (business_id, posting_enabled, po_approved_action, po_completed_action, po_payment_sync_enabled, po_receipt_journal_enabled,
        so_approved_action, so_completed_action, so_payment_sync_enabled,
        manual_customer_cn_action, supplier_cn_action, shortfall_credit_draft_first,
        pos_batch_sync_enabled, pos_batch_payment_sync_enabled,
        online_batch_action, online_batch_payment_sync_enabled,
        shopify_refund_cn_enabled, shopify_payout_posting_enabled, shopify_payout_auto_post_enabled,
        pos_cash_banking_enabled, stocktake_journal_enabled, gift_card_accounting_enabled, store_credit_accounting_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       posting_enabled = VALUES(posting_enabled),
       po_approved_action = VALUES(po_approved_action),
       po_completed_action = VALUES(po_completed_action),
       po_payment_sync_enabled = VALUES(po_payment_sync_enabled),
      po_receipt_journal_enabled = VALUES(po_receipt_journal_enabled),
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
      shopify_refund_cn_enabled = VALUES(shopify_refund_cn_enabled),
      shopify_payout_posting_enabled = VALUES(shopify_payout_posting_enabled),
      shopify_payout_auto_post_enabled = VALUES(shopify_payout_auto_post_enabled),
      pos_cash_banking_enabled = VALUES(pos_cash_banking_enabled),
      stocktake_journal_enabled = VALUES(stocktake_journal_enabled),
      gift_card_accounting_enabled = VALUES(gift_card_accounting_enabled),
      store_credit_accounting_enabled = VALUES(store_credit_accounting_enabled),
       updated_at = NOW()`,
    [
      input.businessId,
      input.policy.postingEnabled ? 1 : 0,
      input.policy.poApprovedAction,
      input.policy.poCompletedAction,
      input.policy.poPaymentSyncEnabled ? 1 : 0,
      input.policy.poReceiptJournalEnabled ? 1 : 0,
      input.policy.soApprovedAction,
      input.policy.soCompletedAction,
      input.policy.soPaymentSyncEnabled ? 1 : 0,
      input.policy.manualCustomerCreditNoteAction,
      input.policy.supplierCreditNoteAction,
      input.policy.shortfallCreditDraftFirst ? 1 : 0,
      input.policy.posBatchSyncEnabled ? 1 : 0,
      input.policy.posBatchPaymentSyncEnabled ? 1 : 0,
      input.policy.onlineBatchAction,
      input.policy.onlineBatchPaymentSyncEnabled ? 1 : 0,
      input.policy.shopifyRefundCreditNoteEnabled ? 1 : 0,
      input.policy.shopifyPayoutPostingEnabled ? 1 : 0,
      input.policy.shopifyPayoutAutoPostEnabled ? 1 : 0,
      input.policy.posCashBankingEnabled ? 1 : 0,
      input.policy.stocktakeJournalEnabled ? 1 : 0,
      input.policy.giftCardAccountingEnabled ? 1 : 0,
      input.policy.storeCreditAccountingEnabled ? 1 : 0,
    ],
    );
    await connection.execute(
      `INSERT INTO xero_document_policy_events
         (business_id, actor_id, actor_name, preset_source, before_policy, after_policy, changed_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.businessId, input.actorId == null ? null : String(input.actorId), input.actorName ?? null,
        input.presetSource ?? null, JSON.stringify(before), JSON.stringify(input.policy), JSON.stringify(changedFields),
      ],
    );
    await connection.commit();
    return { before, changedFields };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}