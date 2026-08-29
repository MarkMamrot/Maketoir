import { NextResponse } from 'next/server';
import { AiAccountRepository } from '@/lib/ai/billing/accountRepository';
import { requireSuperAdminTier } from '@/lib/sessionUtils';

export async function GET(_request: Request, { params }: { params: { businessId: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const detail = await AiAccountRepository.tenantDetail(params.businessId);
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: 'AI account not found.' }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: { businessId: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const actorName = auth.user.name || auth.user.email;
    if (body.command === 'adjust_credit') return NextResponse.json(await AiAccountRepository.adjustCredit(params.businessId, body, auth.user.userId, actorName));
    if (body.command === 'reset_cycle') return NextResponse.json({ success: await AiAccountRepository.resetCycle(params.businessId, String(body.reason || ''), auth.user.userId, actorName) });
    if (body.command === 'release_unknown') return NextResponse.json({ success: await AiAccountRepository.releaseUnknown(params.businessId, Number(body.callId), String(body.reason || ''), auth.user.userId, actorName) });
    if (body.command === 'configure') return NextResponse.json({ success: await AiAccountRepository.configure(params.businessId, body, auth.user.userId, actorName) });
    return NextResponse.json({ error: 'Unknown command.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI account update failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}