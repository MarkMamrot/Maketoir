import { NextResponse } from 'next/server';
import { ForesightMetaRollbackPreflightService } from '@/lib/foresight/ForesightMetaRollbackPreflightService';
import { requireAdminTier } from '@/lib/sessionUtils';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const recommendationId = Number(params.id);
  const body = await request.json().catch(() => ({})) as { executionId?: unknown; proposalHash?: unknown };
  const executionId = Number(body.executionId);
  if (!Number.isInteger(recommendationId) || recommendationId <= 0 || !Number.isInteger(executionId) || executionId <= 0) {
    return NextResponse.json({ error: 'Valid recommendation and execution ids are required.' }, { status: 400 });
  }
  if (typeof body.proposalHash !== 'string' || !body.proposalHash) {
    return NextResponse.json({ error: 'proposalHash is required.' }, { status: 400 });
  }
  try {
    const preflight = await ForesightMetaRollbackPreflightService.preflight(user.businessId, recommendationId, executionId, body.proposalHash);
    return NextResponse.json({ success: true, preflight });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Meta rollback preflight failed.' }, { status: 502 });
  }
}
