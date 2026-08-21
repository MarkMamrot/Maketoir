import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { imsQuery } from '@/services/IMSMySQLService';

type Ctx = { params: { id: string } };

export async function GET(_request: Request, { params }: Ctx) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  return runImsForBusiness(session.businessId, async () => {
    try {
      const rows = await imsQuery<any>(
        `SELECT o.id, o.so_number, o.status, o.order_date, o.expected_date, o.fulfilled_date,
                o.payment_terms, o.subtotal, o.tax_amount, o.total_amount, o.currency_code,
                o.created_at, o.updated_at, wl.id AS wholesale_location_id, wl.location_name
           FROM ims_sales_orders o
           JOIN ims_wholesale_member_locations ml
             ON ml.business_id = o.business_id AND ml.company_id = o.wholesale_company_id
            AND ml.member_id = o.wholesale_member_id AND ml.location_id = o.wholesale_location_id
           JOIN ims_wholesale_company_locations wl
             ON wl.id = ml.location_id AND wl.business_id = ml.business_id
            AND wl.company_id = ml.company_id AND wl.status = 'active'
          WHERE o.id = ? AND o.business_id = ? AND o.customer_id = ?
            AND o.wholesale_company_id = ? AND o.wholesale_member_id = ?
            AND o.is_staff_preview_test = 0
          LIMIT 1`,
        [id, session.businessId, session.contactId, session.companyId, session.memberId],
      );
      const order = rows[0];
      if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const items = await imsQuery<any>(
        `SELECT i.id, i.variant_id, COALESCE(p.name, 'Product') AS product_name,
                pv.sku,
                NULLIF(CONCAT_WS(' / ', NULLIF(pv.option1_value, ''), NULLIF(pv.option2_value, ''), NULLIF(pv.option3_value, '')), '') AS variant_label,
                i.qty_ordered, i.qty_fulfilled, i.unit_price, i.discount_pct, i.tax_rate, i.line_total
           FROM ims_sales_order_items i
           LEFT JOIN ims_product_variants pv ON pv.variant_id = i.variant_id AND pv.business_id = ?
           LEFT JOIN ims_products p ON p.product_id = pv.product_id AND p.business_id = ?
          WHERE i.so_id = ?
          ORDER BY i.id`,
        [session.businessId, session.businessId, id],
      );

      return NextResponse.json({ success: true, order: { ...order, items } });
    } catch (error) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'wholesale_portal',
        operation: 'load_sales_order_detail',
        title: 'Wholesale sales order detail could not be loaded',
        error,
        reference: { type: 'sales_order', id },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: 'Order details could not be loaded.' }, { status: 500 });
    }
  });
}