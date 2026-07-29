import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { isRecommendationReason } from '@/lib/foresight/recommendationReasons';
import { ForesightRepository } from '@/lib/foresight/repositories/ForesightRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { DEFAULT_BUSINESS_TIME_ZONE, getBusinessTimeZone } from '@/lib/ims/businessTimeZone';

type TransitionAction = 'request_approval' | 'approve' | 'reject' | 'attest_implemented';

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { user, response } = requireAdminTier();
  if (response) return response;

  const recommendationId = Number(params.id);
  if (!Number.isInteger(recommendationId) || recommendationId <= 0) {
    return NextResponse.json({ error: 'Invalid recommendation id.' }, { status: 400 });
  }
  const body = await request.json().catch(() => ({})) as {
    action?: TransitionAction;
    proposalHash?: string | null;
    reasonCode?: string;
    note?: string;
    implementedOn?: string;
  };
  if (!['request_approval', 'approve', 'reject', 'attest_implemented'].includes(body.action ?? '')) {
    return NextResponse.json({ error: 'Invalid transition action.' }, { status: 400 });
  }
  if (body.proposalHash !== null && typeof body.proposalHash !== 'string') {
    return NextResponse.json({ error: 'proposalHash must be a string or null.' }, { status: 400 });
  }
  if (body.action !== 'attest_implemented' && (!body.action || !isRecommendationReason(body.action, body.reasonCode))) {
    return NextResponse.json({ error: 'A valid reasonCode is required for this action.' }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > 1000) {
    return NextResponse.json({ error: 'Note must be 1000 characters or fewer.' }, { status: 400 });
  }
  if (body.action === 'attest_implemented') {
    if (!isIsoDate(body.implementedOn)) {
      return NextResponse.json({ error: 'implementedOn must be a YYYY-MM-DD date.' }, { status: 400 });
    }
    const timeZone = await runImsForBusiness(
      user.businessId,
      () => getBusinessTimeZone(user.businessId),
    ).catch(() => DEFAULT_BUSINESS_TIME_ZONE);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone });
    if (body.implementedOn > today) {
      return NextResponse.json({ error: 'Implementation date cannot be in the future.' }, { status: 400 });
    }
    if (note.length < 3) {
      return NextResponse.json({ error: 'Describe what was implemented in at least 3 characters.' }, { status: 400 });
    }
    if (typeof body.proposalHash !== 'string' || body.proposalHash.length === 0) {
      return NextResponse.json({ error: 'proposalHash is required.' }, { status: 400 });
    }
  }

  try {
    if (body.action === 'attest_implemented') {
      await ForesightRepository.attestRecommendationImplementation(
        user.businessId,
        recommendationId,
        user.userId,
        body.proposalHash as string,
        body.implementedOn,
        note,
      );
    } else if (body.action === 'request_approval') {
      await ForesightRepository.requestRecommendationApproval(
        user.businessId,
        recommendationId,
        user.userId,
        body.proposalHash ?? null,
        body.reasonCode,
        note || null,
      );
    } else {
      await ForesightRepository.decideRecommendation(
        user.businessId,
        recommendationId,
        body.action === 'approve' ? 'approved' : 'rejected',
        user.userId,
        body.proposalHash ?? null,
        body.reasonCode,
        note || null,
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recommendation transition failed.';
    const status = message.includes('not found') ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}