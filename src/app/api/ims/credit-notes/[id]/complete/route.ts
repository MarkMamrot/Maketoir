import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';
import { triggerCNXeroSync } from '@/lib/ims/xeroHooks';


export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const cnId = Number(params.id);
  try {
    await ImsCNRepo.complete(cnId, businessId);
    // Fire-and-forget Xero sync
    triggerCNXeroSync(businessId, cnId).catch(err => console.error('[Xero] CN credit note sync failed:', err));
    const cn = await ImsCNRepo.get(cnId, businessId);
    return NextResponse.json({ success: true, data: cn });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
