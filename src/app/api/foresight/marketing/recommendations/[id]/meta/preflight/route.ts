import { NextResponse } from 'next/server';
import { ForesightMetaExecutionPreflightService } from '@/lib/foresight/ForesightMetaExecutionPreflightService';
import { requireAdminTier } from '@/lib/sessionUtils';

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
  const body = await request.json().catch(() => ({})) as { proposalHash?: unknown };
  if (typeof body.proposalHash !== 'string' || body.proposalHash.length === 0) {
    return NextResponse.json({ error: 'proposalHash is required.' }, { status: 400 });
  }

  try {
    const preflight = await ForesightMetaExecutionPreflightService.preflight(
      user.businessId,
      recommendationId,
      body.proposalHash,
    );
    return NextResponse.json({ success: true, preflight });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Meta preflight failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}