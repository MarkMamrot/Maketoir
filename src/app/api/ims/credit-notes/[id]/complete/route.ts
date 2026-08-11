import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';
import { triggerCNXeroSync } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';


export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  const cnId = Number(params.id);
  try {
    await ImsCNRepo.complete(cnId, businessId);
    triggerCNXeroSync(businessId, cnId).catch(error => reportRuntimeIssue({
      businessId,
      source: 'ims_credit_notes',
      operation: 'complete_xero_sync',
      title: 'Customer credit note completed but Xero sync failed',
      error,
      reference: { type: 'credit_note', id: cnId },
    }).catch(() => {}));
    const cn = await ImsCNRepo.get(cnId, businessId);
    return NextResponse.json({
      success: true,
      data: cn,
      xeroSync: {
        state: 'queued',
        queuedAt: new Date().toISOString(),
        retryEligible: true,
        pollEndpoint: `/api/ims/credit-notes/${cnId}/xero-status`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
