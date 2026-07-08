import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// POST /api/ims/credit-notes/[id]/awaiting — draft → awaiting_product
// (goods not yet received; refund pending). No stock/Xero effect.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const cnId = Number(params.id);
  try {
    await ImsCNRepo.setAwaiting(cnId, businessId);
    const cn = await ImsCNRepo.get(cnId, businessId);
    return NextResponse.json({ success: true, data: cn });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
