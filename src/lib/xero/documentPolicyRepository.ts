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
};

export async function getXeroDocumentPolicy(businessId: string): Promise<XeroDocumentPolicy> {
  const rows = await query<XeroDocumentPolicyRow>(
    `SELECT po_approved_action, po_completed_action, po_payment_sync_enabled,
            so_approved_action, so_completed_action, so_payment_sync_enabled
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
  };
}

export async function saveXeroDocumentPolicy(
  businessId: string,
  policy: XeroDocumentPolicy,
): Promise<void> {
  await execute(
    `INSERT INTO xero_document_policies
       (business_id, po_approved_action, po_completed_action, po_payment_sync_enabled,
        so_approved_action, so_completed_action, so_payment_sync_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       po_approved_action = VALUES(po_approved_action),
       po_completed_action = VALUES(po_completed_action),
       po_payment_sync_enabled = VALUES(po_payment_sync_enabled),
       so_approved_action = VALUES(so_approved_action),
       so_completed_action = VALUES(so_completed_action),
       so_payment_sync_enabled = VALUES(so_payment_sync_enabled),
       updated_at = NOW()`,
    [
      businessId,
      policy.poApprovedAction,
      policy.poCompletedAction,
      policy.poPaymentSyncEnabled ? 1 : 0,
      policy.soApprovedAction,
      policy.soCompletedAction,
      policy.soPaymentSyncEnabled ? 1 : 0,
    ],
  );
}