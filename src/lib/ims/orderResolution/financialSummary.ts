import { imsQuery } from '@/services/IMSMySQLService';

export type OrderResolutionFinancialSummary = {
  resolutionId: number;
  role: 'source' | 'backorder';
  side: 'customer' | 'supplier';
  sourceOrderId: number;
  childOrderId: number | null;
  creditNoteId: number | null;
  creditNoteNumber: string | null;
  xeroCreditNoteId: string | null;
  amount: number;
  currencyCode: string;
  resolutionState: string;
  settlementId: number | null;
  settlementType: string | null;
  settlementStatus: string | null;
  settlementXeroId: string | null;
  settlementError: string | null;
};

export async function getOrderResolutionFinancialSummaries(
  businessId: string,
  side: 'customer' | 'supplier',
  orderId: number,
): Promise<OrderResolutionFinancialSummary[]> {
  if (side === 'customer') {
    return imsQuery<OrderResolutionFinancialSummary>(
      `SELECT r.id AS resolutionId,
              CASE WHEN r.source_so_id = ? THEN 'source' ELSE 'backorder' END AS role,
              'customer' AS side, r.source_so_id AS sourceOrderId, r.child_so_id AS childOrderId,
              r.credit_note_id AS creditNoteId, cn.cn_number AS creditNoteNumber,
              cn.xero_credit_note_id AS xeroCreditNoteId, r.outstanding_amount AS amount,
              r.currency_code AS currencyCode, r.state AS resolutionState,
              s.id AS settlementId, s.action_type AS settlementType, s.status AS settlementStatus,
              s.xero_id AS settlementXeroId, s.safe_error AS settlementError
         FROM ims_so_shortfall_resolutions r
         LEFT JOIN ims_credit_notes cn ON cn.id = r.credit_note_id AND cn.business_id = r.business_id
         LEFT JOIN ims_customer_credit_settlements s ON s.resolution_id = r.id AND s.business_id = r.business_id
          AND s.id = (SELECT MAX(current_s.id) FROM ims_customer_credit_settlements current_s WHERE current_s.business_id = r.business_id AND current_s.resolution_id = r.id)
        WHERE r.business_id = ? AND (r.source_so_id = ? OR r.child_so_id = ?)
        ORDER BY r.created_at DESC, s.id DESC`,
      [orderId, businessId, orderId, orderId],
    );
  }

  return imsQuery<OrderResolutionFinancialSummary>(
    `SELECT r.id AS resolutionId,
            CASE WHEN r.source_po_id = ? THEN 'source' ELSE 'backorder' END AS role,
            'supplier' AS side, r.source_po_id AS sourceOrderId, r.child_po_id AS childOrderId,
            r.supplier_credit_note_id AS creditNoteId, scn.scn_number AS creditNoteNumber,
            scn.xero_credit_note_id AS xeroCreditNoteId, r.outstanding_amount AS amount,
            r.currency_code AS currencyCode, r.state AS resolutionState,
            s.id AS settlementId, s.action_type AS settlementType, s.status AS settlementStatus,
            s.xero_id AS settlementXeroId, s.safe_error AS settlementError
       FROM ims_po_shortfall_resolutions r
       LEFT JOIN ims_supplier_credit_notes scn ON scn.id = r.supplier_credit_note_id AND scn.business_id = r.business_id
      LEFT JOIN ims_supplier_credit_settlements s ON s.resolution_id = r.id AND s.business_id = r.business_id
       AND s.id = (SELECT MAX(current_s.id) FROM ims_supplier_credit_settlements current_s WHERE current_s.business_id = r.business_id AND current_s.resolution_id = r.id)
      WHERE r.business_id = ? AND (r.source_po_id = ? OR r.child_po_id = ?)
      ORDER BY r.created_at DESC, s.id DESC`,
    [orderId, businessId, orderId, orderId],
  );
}
