import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';


// POST /api/ims/credit-notes/[id]/awaiting — draft → awaiting_product
// (goods not yet received; refund pending). No stock/Xero effect.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
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
