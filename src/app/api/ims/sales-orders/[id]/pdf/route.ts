import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { generateOrderPdf } from '@/lib/ims/generateOrderPdf';
import {
  getSalesDocumentFilename,
  isSalesDocumentAvailable,
  parseSalesDocumentType,
  type SOStatus,
} from '@/lib/ims/orderLifecyclePolicy';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';


async function getSettings(businessId: string): Promise<Record<string, string>> {
  const rows = await imsQuery<{ key: string; value: string }>(
    'SELECT `key`, `value` FROM ims_settings WHERE business_id = ?',
    [businessId]
  );
  const s: Record<string, string> = {};
  for (const r of rows) s[r.key] = r.value ?? '';
  return s;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const document = parseSalesDocumentType(new URL(req.url).searchParams.get('document'));
  if (!document) {
    return NextResponse.json({ error: 'A valid document type is required.' }, { status: 400 });
  }

  try {
    const so = await ImsSORepo.get(Number(params.id), session.businessId);
    if (!so) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!isSalesDocumentAvailable(document, so.status as SOStatus)) {
      return NextResponse.json(
        { error: `${document} is not available while this sales order is ${so.status}.` },
        { status: 409 },
      );
    }

    const settings = await getSettings(session.businessId);
    const businessName = settings['business_name'] || session.company || 'Business';

    const pdfBuf = await generateOrderPdf({
      type: 'so',
      order: so,
      businessName,
      salesDocumentType: document,
      xeroInvoiceNumber: so.xero_invoice_number || undefined,
      logoBase64:          settings['logo_base64']       || undefined,
      businessAddress:     settings['business_address']  || undefined,
      businessAbn:         settings['business_abn']      || undefined,
      termsAndConditions:  settings['so_terms']          || undefined,
      showSalesDocumentLogo: settings['sales_document_show_logo'] !== '0',
      invoiceNote: settings['sales_document_note'] || undefined,
      bankingDetails: {
        accountName: settings['sales_document_bank_account_name'] || undefined,
        bsb: settings['sales_document_bank_bsb'] || undefined,
        accountNumber: settings['sales_document_bank_account_number'] || undefined,
        paymentInstructions: settings['sales_document_payment_instructions'] || undefined,
      },
    });

    const filename = getSalesDocumentFilename(document, so.so_number, so.xero_invoice_number);
    return new NextResponse(pdfBuf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        'Content-Length':      String(pdfBuf.length),
      },
    });
  } catch (e: any) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims_sales_documents',
      operation: 'generate_pdf',
      title: 'Sales document PDF generation failed',
      error: e,
      context: { salesOrderId: Number(params.id), document },
      reference: { type: 'sales_order', id: Number(params.id) },
    });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
