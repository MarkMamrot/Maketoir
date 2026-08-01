import { NextResponse } from 'next/server';
import { ForesightPlanningRepository } from '@/lib/foresight/repositories/ForesightPlanningRepository';
import type { PlanningThreadType } from '@/lib/foresight/planning/planDocument';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

const THREAD_TYPES: PlanningThreadType[] = ['strategy', 'recommendation', 'initiative'];

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const threads = await ForesightPlanningRepository.listThreads(user.businessId, 50);
  return NextResponse.json({ success: true, threads });
}

export async function POST(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const threadType = typeof body?.threadType === 'string' ? body.threadType : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!THREAD_TYPES.includes(threadType as PlanningThreadType)) {
    return NextResponse.json({ error: 'threadType must be strategy, recommendation, or initiative.' }, { status: 400 });
  }
  if (title.length < 3 || title.length > 200) {
    return NextResponse.json({ error: 'title must be between 3 and 200 characters.' }, { status: 400 });
  }
  const id = await ForesightPlanningRepository.createThread(user.businessId, {
    threadType: threadType as PlanningThreadType,
    title,
    createdBy: user.userId,
  });
  const thread = await ForesightPlanningRepository.getThread(user.businessId, id);
  return NextResponse.json({ success: true, thread }, { status: 201 });
}