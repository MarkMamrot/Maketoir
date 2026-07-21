import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo } from '@/lib/ims/ImsRepository';
import { triggerSupplierCNXeroSync } from '@/lib/ims/xeroHooks';


export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const scnId = Number(params.id);
  try {
    await ImsSupplierCNRepo.complete(scnId, businessId);
    // Fire-and-forget Xero ACCPAY credit note sync
    triggerSupplierCNXeroSync(businessId, scnId).catch(err => console.error('[Xero] supplier CN sync failed:', err));
    const scn = await ImsSupplierCNRepo.get(scnId, businessId);
    return NextResponse.json({ success: true, data: scn });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
