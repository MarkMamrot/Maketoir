import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';

export interface InboundPlanningRow {
  purchaseOrderId: number;
  purchaseOrderNumber: string;
  status: 'confirmed' | 'partially_received';
  orderDate: string;
  expectedDate: string | null;
  supplierName: string | null;
  variantId: string;
  sku: string | null;
  productName: string;
  variantLabel: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityOutstanding: number;
  updatedAt: string | null;
}

interface InboundPlanningDbRow {
  po_id: number;
  po_number: string;
  status: 'confirmed' | 'partially_received';
  order_date: string;
  expected_date: string | null;
  supplier_name: string | null;
  variant_id: string;
  sku: string | null;
  product_name: string;
  variant_label: string;
  qty_ordered: number | string;
  qty_received: number | string;
  qty_outstanding: number | string;
  updated_at: string | null;
}

export const ImsInboundPlanningRepository = {
  async listOpenInbound(businessId: string, limit: number): Promise<InboundPlanningRow[]> {
    return runImsForBusiness(businessId, async () => {
      const rows = await imsQuery<InboundPlanningDbRow>(
        `SELECT po.id AS po_id,
                po.po_number,
                po.status,
                po.order_date,
                po.expected_date,
                supplier.name AS supplier_name,
                item.variant_id,
                variant.sku,
                product.name AS product_name,
                CONCAT_WS(' / ', NULLIF(variant.option1_value, ''), NULLIF(variant.option2_value, ''), NULLIF(variant.option3_value, '')) AS variant_label,
                item.qty_ordered,
                item.qty_received,
                GREATEST(item.qty_ordered - item.qty_received, 0) AS qty_outstanding,
                po.updated_at
           FROM ims_purchase_orders po
           JOIN ims_purchase_order_items item
             ON item.po_id = po.id
            AND item.business_id = ?
           JOIN ims_product_variants variant
             ON variant.variant_id = item.variant_id
            AND variant.business_id = ?
           JOIN ims_products product
             ON product.product_id = variant.product_id
            AND product.business_id = ?
           LEFT JOIN ims_contacts supplier ON supplier.id = po.supplier_id
          WHERE po.business_id = ?
            AND po.status IN ('confirmed', 'partially_received')
            AND item.qty_ordered > item.qty_received
          ORDER BY po.expected_date IS NULL,
                   po.expected_date,
                   po.order_date,
                   po.id,
                   product.name
          LIMIT ${limit}`,
        [businessId, businessId, businessId, businessId],
      );
      return rows.map((row) => ({
        purchaseOrderId: Number(row.po_id),
        purchaseOrderNumber: row.po_number,
        status: row.status,
        orderDate: String(row.order_date).slice(0, 10),
        expectedDate: row.expected_date ? String(row.expected_date).slice(0, 10) : null,
        supplierName: row.supplier_name,
        variantId: row.variant_id,
        sku: row.sku,
        productName: row.product_name,
        variantLabel: row.variant_label || 'Default',
        quantityOrdered: Number(row.qty_ordered),
        quantityReceived: Number(row.qty_received),
        quantityOutstanding: Number(row.qty_outstanding),
        updatedAt: row.updated_at,
      }));
    });
  },
};