import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { generateOrderPdf } from '@/lib/ims/generateOrderPdf';
import {
  getSalesDocumentFilename,
  isSalesDocumentAvailable,
  parseSalesDocumentType,
  type SOStatus,
} from '@/lib/ims/orderLifecyclePolicy';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { imsQuery } from '@/services/IMSMySQLService';

type Ctx = { params: { id: string } };

const settingKeys = [
  'business_name',
  'logo_base64',
  'business_address',
  'business_abn',
  'so_terms',
  'sales_document_show_logo',
  'sales_document_note',
  'sales_document_bank_account_name',
  'sales_document_bank_bsb',
  'sales_document_bank_account_number',
  'sales_document_payment_instructions',
] as const;

export async function GET(request: Request, { params }: Ctx) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const document = parseSalesDocumentType(new URL(request.url).searchParams.get('document'));
  if (!document) {
    return NextResponse.json({ error: 'A valid document type is required.' }, { status: 400 });
  }

  return runImsForBusiness(session.businessId, async () => {
    try {
      const orderRows = await imsQuery<any>(
        `SELECT o.id, o.so_number, o.status, o.order_date, o.expected_date, o.fulfilled_date,
                o.delivery_address, o.delivery_address2, o.delivery_suburb, o.delivery_city,
                o.delivery_state, o.delivery_postcode, o.delivery_country, o.payment_terms,
                o.tax_treatment, o.freight, o.discount, o.subtotal, o.tax_amount, o.total_amount,
                o.currency_code, o.xero_invoice_number,
                wc.company_name AS customer_name, c.email AS customer_email,
                wl.location_name
           FROM ims_sales_orders o
           JOIN ims_wholesale_companies wc
             ON wc.id = o.wholesale_company_id AND wc.business_id = o.business_id
           JOIN ims_wholesale_company_locations wl
             ON wl.id = o.wholesale_location_id AND wl.company_id = o.wholesale_company_id
            AND wl.business_id = o.business_id
           LEFT JOIN ims_contacts c ON c.id = o.customer_id AND c.business_id = o.business_id
          WHERE o.id = ? AND o.business_id = ? AND o.customer_id = ?
            AND o.wholesale_company_id = ? AND o.wholesale_member_id = ?
            AND o.is_staff_preview_test = 0
            AND EXISTS (
              SELECT 1 FROM ims_wholesale_member_locations ml
               WHERE ml.business_id = o.business_id AND ml.company_id = o.wholesale_company_id
                 AND ml.member_id = o.wholesale_member_id AND ml.location_id = o.wholesale_location_id
            )
          LIMIT 1`,
        [id, session.businessId, session.contactId, session.companyId, session.memberId],
      );
      const order = orderRows[0];
      if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      if (!isSalesDocumentAvailable(document, order.status as SOStatus)) {
        return NextResponse.json(
          { error: `${document} is not available while this sales order is ${order.status}.` },
          { status: 409 },
        );
      }

      const [items, settingRows] = await Promise.all([
        imsQuery<any>(
          `SELECT i.id, i.variant_id, COALESCE(p.name, 'Product') AS product_name,
                  pv.sku,
                  NULLIF(CONCAT_WS(' / ', NULLIF(pv.option1_value, ''), NULLIF(pv.option2_value, ''), NULLIF(pv.option3_value, '')), '') AS variant_label,
                  i.qty_ordered, i.qty_fulfilled, i.unit_price, i.discount_pct, i.tax_rate, i.line_total
             FROM ims_sales_order_items i
             LEFT JOIN ims_product_variants pv ON pv.variant_id = i.variant_id AND pv.business_id = ?
             LEFT JOIN ims_products p ON p.product_id = pv.product_id AND p.business_id = ?
            WHERE i.so_id = ? AND i.business_id = ?
            ORDER BY i.id`,
          [session.businessId, session.businessId, id, session.businessId],
        ),
        imsQuery<{ key: string; value: string }>(
          `SELECT \`key\`, \`value\` FROM ims_settings
            WHERE business_id = ? AND \`key\` IN (${settingKeys.map(() => '?').join(',')})`,
          [session.businessId, ...settingKeys],
        ),
      ]);
      const settings = Object.fromEntries(settingRows.map(row => [row.key, row.value ?? '']));
      const printableOrder = { ...order, items };
      const pdf = await generateOrderPdf({
        type: 'so',
        order: printableOrder,
        businessName: settings.business_name || 'Supplier',
        salesDocumentType: document,
        xeroInvoiceNumber: order.xero_invoice_number || undefined,
        logoBase64: settings.logo_base64 || undefined,
        businessAddress: settings.business_address || undefined,
        businessAbn: settings.business_abn || undefined,
        termsAndConditions: settings.so_terms || undefined,
        showSalesDocumentLogo: settings.sales_document_show_logo !== '0',
        invoiceNote: settings.sales_document_note || undefined,
        bankingDetails: {
          accountName: settings.sales_document_bank_account_name || undefined,
          bsb: settings.sales_document_bank_bsb || undefined,
          accountNumber: settings.sales_document_bank_account_number || undefined,
          paymentInstructions: settings.sales_document_payment_instructions || undefined,
        },
      });
      const filename = getSalesDocumentFilename(document, order.so_number, order.xero_invoice_number);

      return new NextResponse(pdf as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}.pdf"`,
          'Content-Length': String(pdf.length),
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (error) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'wholesale_portal',
        operation: 'generate_sales_document_pdf',
        title: 'Wholesale sales document PDF could not be generated',
        error,
        context: { document },
        reference: { type: 'sales_order', id },
      }).catch(() => {});
      return NextResponse.json({ error: 'Order document could not be generated.' }, { status: 500 });
    }
  });
}