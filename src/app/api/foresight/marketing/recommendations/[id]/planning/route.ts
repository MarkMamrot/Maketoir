import { NextResponse } from 'next/server';
import { ForesightPlanningRepository } from '@/lib/foresight/repositories/ForesightPlanningRepository';
import { ForesightRepository } from '@/lib/foresight/repositories/ForesightRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function recommendationId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function planningContext(businessId: string, id: number) {
  const recommendation = await ForesightRepository.getRecommendation(businessId, id);
  if (!recommendation) return null;
  const thread = await ForesightPlanningRepository.findThreadForLink(businessId, 'recommendation', String(id));
  const latestPlan = thread
    ? await ForesightPlanningRepository.latestPlanVersion(businessId, thread.id)
    : null;
  return {
    recommendation,
    thread,
    latestPlan: latestPlan ? { version: latestPlan.version, state: latestPlan.state } : null,
  };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const id = recommendationId(params.id);
  if (id == null) return NextResponse.json({ error: 'Invalid recommendation id.' }, { status: 400 });
  const context = await planningContext(user.businessId, id);
  if (!context) return NextResponse.json({ error: 'Recommendation not found.' }, { status: 404 });
  return NextResponse.json({ success: true, thread: context.thread, latestPlan: context.latestPlan });
}

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const id = recommendationId(params.id);
  if (id == null) return NextResponse.json({ error: 'Invalid recommendation id.' }, { status: 400 });
  const context = await planningContext(user.businessId, id);
  if (!context) return NextResponse.json({ error: 'Recommendation not found.' }, { status: 404 });
  if (context.thread) {
    return NextResponse.json({ success: true, thread: context.thread, latestPlan: context.latestPlan, created: false });
  }

  const label = context.recommendation.rule_id.replaceAll('_', ' ');
  const systemContent = `Planning context is linked to recommendation ${id}. Use get_recommendation with recommendationId ${id} before making factual claims about it. This link does not authorize approval or execution.`;
  const result = await ForesightPlanningRepository.getOrCreateRecommendationThread(user.businessId, id, {
    title: `Plan: ${label}`.slice(0, 200),
    createdBy: user.userId,
    systemContent,
    systemMessage: { recommendationId: id, contextType: 'recommendation_link' },
  });
  const thread = await ForesightPlanningRepository.getThread(user.businessId, result.threadId);
  const latestPlan = result.created
    ? null
    : await ForesightPlanningRepository.latestPlanVersion(user.businessId, result.threadId);
  return NextResponse.json({
    success: true,
    thread,
    latestPlan: latestPlan ? { version: latestPlan.version, state: latestPlan.state } : null,
    created: result.created,
  }, { status: result.created ? 201 : 200 });
}