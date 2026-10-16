import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { actorId, readBody } from '@/lib/ims/consignment/http';
import { deliverStatement } from '@/lib/ims/consignment/delivery';
import { ConsignmentError, requireId } from '@/lib/ims/consignment/domain';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  if (!['Admin', 'SuperAdmin'].includes(session.tier ?? '')) return NextResponse.json({ success: false, error: 'Only administrators can send supplier statements.' }, { status: 403 });
  try {
    const body = await readBody(req);
    const result = await deliverStatement(session.businessId, actorId(session), requireId(params.id), body);
    const success = result.status === 'Sent' || body.action === 'resolve';
    return NextResponse.json({ success, data: result,
      ...(!success ? { error: result.status === 'Failed' ? 'Provider rejected this email. Review the failed attempt before retrying.' : 'Delivery is sending or unconfirmed. Do not resend until the outcome is reviewed.' } : {}),
    }, { status: success ? 200 : 409, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ConsignmentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    await reportRuntimeIssue({ businessId: session.businessId, source: 'ims.consignment', operation: 'statement-send', title: 'Consignment statement delivery failed', error, reference: { type: 'consignment-statement', id: params.id } });
    return NextResponse.json({ success: false, error: 'Statement delivery failed. Review existing attempts before retrying.' }, { status: 500 });
  }
}
