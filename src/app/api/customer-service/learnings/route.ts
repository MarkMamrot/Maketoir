import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { listLearningCandidates, reviewLearningCandidate } from '@/lib/customer-service/learningCurator';

export async function GET() {
  const { user, response } = requireAdminSession(); if (response) return response;
  return NextResponse.json({ success: true, candidates: await listLearningCandidates(user.businessId) });
}

export async function PATCH(req: Request) {
  const { user, response } = requireAdminSession(); if (response) return response;
  const body = await req.json();
  if (!['active', 'rejected'].includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  await reviewLearningCandidate({ businessId: user.businessId, id: Number(body.id), status: body.status, userId: user.userId, markdown: body.markdown });
  return NextResponse.json({ success: true });
}