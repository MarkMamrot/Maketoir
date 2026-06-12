import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { generateOrderPdf } from '@/lib/ims/generateOrderPdf';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

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
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const so = await ImsSORepo.get(Number(params.id));
    if (!so) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const settings = await getSettings(session.userSpreadsheetId);
    const businessName = settings['business_name'] || session.company || 'Business';

    const pdfBuf = await generateOrderPdf({
      type: 'so',
      order: so,
      businessName,
      logoBase64:          settings['logo_base64']       || undefined,
      businessAddress:     settings['business_address']  || undefined,
      businessAbn:         settings['business_abn']      || undefined,
      termsAndConditions:  settings['so_terms']          || undefined,
    });

    const filename = so.so_number.replace('SO-', 'INV-');
    return new NextResponse(pdfBuf, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        'Content-Length':      String(pdfBuf.length),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
