import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { ForesightRepository } from '@/lib/foresight/repositories/ForesightRepository';

type TransitionAction = 'request_approval' | 'approve' | 'reject';

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
    note?: string;
  };
  if (!['request_approval', 'approve', 'reject'].includes(body.action ?? '')) {
    return NextResponse.json({ error: 'Invalid transition action.' }, { status: 400 });
  }
  if (body.proposalHash !== null && typeof body.proposalHash !== 'string') {
    return NextResponse.json({ error: 'proposalHash must be a string or null.' }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > 1000) {
    return NextResponse.json({ error: 'Note must be 1000 characters or fewer.' }, { status: 400 });
  }

  try {
    if (body.action === 'request_approval') {
      await ForesightRepository.requestRecommendationApproval(
        user.businessId,
        recommendationId,
        user.userId,
        body.proposalHash ?? null,
        note || null,
      );
    } else {
      await ForesightRepository.decideRecommendation(
        user.businessId,
        recommendationId,
        body.action === 'approve' ? 'approved' : 'rejected',
        user.userId,
        body.proposalHash ?? null,
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