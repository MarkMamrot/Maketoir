import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { generateOrderPdf } from '@/lib/ims/generateOrderPdf';


async function getSettings(businessId: string): Promise<Record<string, string>> {
  const rows = await imsQuery<{ key: string; value: string }>(
    'SELECT `key`, `value` FROM ims_settings WHERE business_id = ?',
    [businessId]
  );
  const s: Record<string, string> = {};
  for (const r of rows) s[r.key] = r.value ?? '';
  return s;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const po = await ImsPORepo.get(Number(params.id), session.businessId);
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const settings = await getSettings(session.businessId);
    const businessName = settings['business_name'] || session.company || 'Business';

    const pdfBuf = await generateOrderPdf({
      type: 'po',
      order: po,
      businessName,
      logoBase64:          settings['logo_base64']       || undefined,
      businessAddress:     settings['business_address']  || undefined,
      businessAbn:         settings['business_abn']      || undefined,
      termsAndConditions:  settings['po_terms']          || undefined,
    });

    return new NextResponse(pdfBuf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${po.po_number}.pdf"`,
        'Content-Length':      String(pdfBuf.length),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
