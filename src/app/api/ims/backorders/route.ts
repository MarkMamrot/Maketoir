import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';

type BackorderLine = {
  order_id: number;
  item_id: number;
  variant_id: string | null;
  sku: string | null;
  product_name: string | null;
  variant_label: string | null;
  qty_ordered: number;
  qty_on_hand: number;
  qty_committed: number;
  qty_incoming: number;
};

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);

  try {
    const [customerOrders, supplierOrders, customerLines, supplierLines] = await Promise.all([
      imsQuery<any>(
        `SELECT so.id, so.so_number AS order_number, so.customer_id AS contact_id,
                COALESCE(c.name, 'Unknown customer') AS contact_name,
                so.location_id, l.name AS location_name, so.expected_date, so.created_at,
                so.total_amount, so.currency_code, so.exchange_rate, so.tax_treatment, so.tax_code,
                so.payment_terms, so.price_tier, so.customer_po_number AS external_reference,
                GROUP_CONCAT(DISTINCT source.so_number ORDER BY source.so_number SEPARATOR ', ') AS source_orders
           FROM ims_sales_orders so
           LEFT JOIN ims_contacts c ON c.id = so.customer_id
           JOIN ims_locations l ON l.id = so.location_id
           LEFT JOIN ims_so_backorder_lines bl ON bl.backorder_so_id = so.id AND bl.business_id = so.business_id
           LEFT JOIN ims_sales_orders source ON source.id = bl.source_so_id
          WHERE so.business_id = ? AND so.status = 'backordered'
          GROUP BY so.id
          ORDER BY so.created_at ASC`,
        [businessId],
      ),
      imsQuery<any>(
        `SELECT po.id, po.po_number AS order_number, po.supplier_id AS contact_id,
                COALESCE(c.name, po.supplier_name_raw, 'Unknown supplier') AS contact_name,
                po.location_id, l.name AS location_name, po.expected_date, po.created_at,
                po.total_amount, po.currency_code, po.exchange_rate, po.tax_treatment, po.tax_code,
                po.payment_terms, NULL AS price_tier, po.supplier_invoice_number AS external_reference,
                GROUP_CONCAT(DISTINCT source.po_number ORDER BY source.po_number SEPARATOR ', ') AS source_orders
           FROM ims_purchase_orders po
           LEFT JOIN ims_contacts c ON c.id = po.supplier_id
           JOIN ims_locations l ON l.id = po.location_id
           LEFT JOIN ims_po_backorder_lines bl ON bl.backorder_po_id = po.id AND bl.business_id = po.business_id
           LEFT JOIN ims_purchase_orders source ON source.id = bl.source_po_id
          WHERE po.business_id = ? AND po.status = 'backordered'
          GROUP BY po.id
          ORDER BY po.created_at ASC`,
        [businessId],
      ),
      imsQuery<BackorderLine>(
        `SELECT i.so_id AS order_id, i.id AS item_id, i.variant_id, v.sku, p.name AS product_name,
                CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label,
                i.qty_ordered, i.unit_price AS unit_amount, i.discount_pct, i.tax_rate, i.notes,
                COALESCE(st.qty_on_hand, 0) AS qty_on_hand,
                COALESCE(st.qty_committed, 0) AS qty_committed, COALESCE(st.qty_incoming, 0) AS qty_incoming
           FROM ims_sales_order_items i
           JOIN ims_sales_orders so ON so.id = i.so_id AND so.business_id = ? AND so.status = 'backordered'
           LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
           LEFT JOIN ims_products p ON p.product_id = v.product_id
           LEFT JOIN ims_stock st ON st.variant_id = i.variant_id AND st.location_id = so.location_id
          ORDER BY i.so_id, i.id`,
        [businessId],
      ),
      imsQuery<BackorderLine>(
        `SELECT i.po_id AS order_id, i.id AS item_id, i.variant_id, v.sku, p.name AS product_name,
                CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label,
                i.qty_ordered, i.unit_cost AS unit_amount, i.discount_pct, i.tax_rate, i.notes,
                COALESCE(st.qty_on_hand, 0) AS qty_on_hand,
                COALESCE(st.qty_committed, 0) AS qty_committed, COALESCE(st.qty_incoming, 0) AS qty_incoming
           FROM ims_purchase_order_items i
           JOIN ims_purchase_orders po ON po.id = i.po_id AND po.business_id = ? AND po.status = 'backordered'
           LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
           LEFT JOIN ims_products p ON p.product_id = v.product_id
           LEFT JOIN ims_stock st ON st.variant_id = i.variant_id AND st.location_id = po.location_id
          ORDER BY i.po_id, i.id`,
        [businessId],
      ),
    ]);

    const attachLines = (orders: any[], lines: BackorderLine[], type: 'customer' | 'supplier') => orders.map(order => {
      const orderLines = lines.filter(line => Number(line.order_id) === Number(order.id));
      const ready = type === 'customer'
        && orderLines.length > 0
        && orderLines.every(line =>
          Number(line.qty_committed) >= Number(line.qty_ordered)
          && Number(line.qty_on_hand) >= Number(line.qty_committed),
        );
      return {
        ...order,
        type,
        ready,
        item_count: orderLines.length,
        total_qty: orderLines.reduce((sum, line) => sum + Number(line.qty_ordered), 0),
        lines: orderLines,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        customer: attachLines(customerOrders, customerLines, 'customer'),
        supplier: attachLines(supplierOrders, supplierLines, 'supplier'),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}