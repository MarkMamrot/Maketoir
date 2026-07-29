import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { ForesightRollbackPreflightService } from '@/lib/foresight/ForesightRollbackPreflightService';

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
  };
  const executionId = Number(body.executionId);
  if (!Number.isInteger(executionId) || executionId <= 0) {
    return NextResponse.json({ error: 'A valid original executionId is required.' }, { status: 400 });
  }
  if (typeof body.proposalHash !== 'string' || body.proposalHash.length === 0) {
    return NextResponse.json({ error: 'proposalHash is required.' }, { status: 400 });
  }

  try {
    const preflight = await ForesightRollbackPreflightService.preflight(
      user.businessId,
      recommendationId,
      executionId,
      body.proposalHash,
    );
    return NextResponse.json({ success: true, preflight });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rollback preflight failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}