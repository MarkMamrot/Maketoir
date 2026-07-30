import { NextResponse } from 'next/server';
import { ForesightMetaRollbackService } from '@/lib/foresight/ForesightMetaRollbackService';
import { requireAdminTier } from '@/lib/sessionUtils';

const CONFIRMATION_PHRASE = 'REVERSE META BUDGET CHANGES';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const recommendationId = Number(params.id);
  const body = await request.json().catch(() => ({})) as {
    executionId?: unknown; proposalHash?: unknown; confirmationFingerprint?: unknown; confirmationPhrase?: unknown;
  };
  const executionId = Number(body.executionId);
  if (!Number.isInteger(recommendationId) || recommendationId <= 0 || !Number.isInteger(executionId) || executionId <= 0) {
    return NextResponse.json({ error: 'Valid recommendation and execution ids are required.' }, { status: 400 });
  }
  if (typeof body.proposalHash !== 'string' || !body.proposalHash) return NextResponse.json({ error: 'proposalHash is required.' }, { status: 400 });
  if (typeof body.confirmationFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(body.confirmationFingerprint)) {
    return NextResponse.json({ error: 'A valid live Meta rollback confirmation is required.' }, { status: 400 });
  }
  if (body.confirmationPhrase !== CONFIRMATION_PHRASE) {
    return NextResponse.json({ error: `Type ${CONFIRMATION_PHRASE} to confirm rollback.` }, { status: 400 });
  }
  try {
    const result = await ForesightMetaRollbackService.rollback({
      businessId: user.businessId, recommendationId, originalExecutionId: executionId,
      actorId: user.userId, proposalHash: body.proposalHash, confirmationFingerprint: body.confirmationFingerprint,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Meta rollback failed.';
    const status = message.includes('changed') || message.includes('blocked') ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
