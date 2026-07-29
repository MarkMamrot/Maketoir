import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { ForesightRollbackService } from '@/lib/foresight/ForesightRollbackService';

const CONFIRMATION_PHRASE = 'REVERSE GOOGLE BUDGET CHANGES';

export async function POST(
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
    executionId?: unknown;
    proposalHash?: unknown;
    confirmationFingerprint?: unknown;
    confirmationPhrase?: unknown;
  };
  const executionId = Number(body.executionId);
  if (!Number.isInteger(executionId) || executionId <= 0) {
    return NextResponse.json({ error: 'A valid original executionId is required.' }, { status: 400 });
  }
  if (typeof body.proposalHash !== 'string' || body.proposalHash.length === 0) {
    return NextResponse.json({ error: 'proposalHash is required.' }, { status: 400 });
  }
  if (typeof body.confirmationFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(body.confirmationFingerprint)) {
    return NextResponse.json({ error: 'A valid live rollback confirmation is required.' }, { status: 400 });
  }
  if (body.confirmationPhrase !== CONFIRMATION_PHRASE) {
    return NextResponse.json({ error: `Type ${CONFIRMATION_PHRASE} to confirm rollback.` }, { status: 400 });
  }

  try {
    const result = await ForesightRollbackService.rollback({
      businessId: user.businessId,
      recommendationId,
      originalExecutionId: executionId,
      actorId: user.userId,
      proposalHash: body.proposalHash,
      confirmationFingerprint: body.confirmationFingerprint,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Ads rollback failed.';
    const status = message.includes('not found') ? 404
      : message.includes('changed') || message.includes('blocked') || message.includes('succeeded') || message.includes('compensat') ? 409
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}