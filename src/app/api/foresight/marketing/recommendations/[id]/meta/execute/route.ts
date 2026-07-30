import { NextResponse } from 'next/server';
import { ForesightMetaExecutionService } from '@/lib/foresight/ForesightMetaExecutionService';
import { requireAdminTier } from '@/lib/sessionUtils';

const CONFIRMATION_PHRASE = 'APPLY META BUDGET CHANGES';

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
    proposalHash?: unknown;
    confirmationFingerprint?: unknown;
    confirmationPhrase?: unknown;
  };
  if (typeof body.proposalHash !== 'string' || body.proposalHash.length === 0) {
    return NextResponse.json({ error: 'proposalHash is required.' }, { status: 400 });
  }
  if (typeof body.confirmationFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(body.confirmationFingerprint)) {
    return NextResponse.json({ error: 'A valid live Meta preflight confirmation is required.' }, { status: 400 });
  }
  if (body.confirmationPhrase !== CONFIRMATION_PHRASE) {
    return NextResponse.json({ error: `Type ${CONFIRMATION_PHRASE} to confirm execution.` }, { status: 400 });
  }

  try {
    const result = await ForesightMetaExecutionService.execute({
      businessId: user.businessId,
      recommendationId,
      actorId: user.userId,
      proposalHash: body.proposalHash,
      confirmationFingerprint: body.confirmationFingerprint,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Meta Ads execution failed.';
    const status = message.includes('not found') ? 404
      : message.includes('changed') || message.includes('blocked') || message.includes('approved') ? 409
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
