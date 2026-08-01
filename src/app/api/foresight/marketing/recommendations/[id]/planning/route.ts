import { NextResponse } from 'next/server';
import { ForesightPlanningRepository } from '@/lib/foresight/repositories/ForesightPlanningRepository';
import { ForesightDeliverableRepository } from '@/lib/foresight/repositories/ForesightDeliverableRepository';
import { ForesightCampaignActivationRepository } from '@/lib/foresight/repositories/ForesightCampaignActivationRepository';
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
  const latestReview = thread
    ? await ForesightPlanningRepository.latestPlanReview(businessId, thread.id)
    : null;
  const latestDeliverable = thread
    ? await ForesightDeliverableRepository.latest(businessId, thread.id)
    : null;
  const latestDeliverableReview = thread
    ? await ForesightDeliverableRepository.latestReview(businessId, thread.id)
    : null;
  const activation = thread
    ? await ForesightCampaignActivationRepository.getForThread(businessId, thread.id)
    : null;
  const activationOutcome = thread
    ? await ForesightCampaignActivationRepository.getOutcomeForThread(businessId, thread.id)
    : null;
  return {
    recommendation,
    thread,
    latestPlan: latestPlan ? {
      id: latestPlan.id,
      version: latestPlan.version,
      state: latestPlan.state,
      planHash: latestPlan.plan_hash,
      title: latestPlan.plan_json.title,
      objective: latestPlan.plan_json.objective,
      planningHorizon: latestPlan.plan_json.planningHorizon,
      selectedOption: latestPlan.plan_json.options.find((option) => option.id === latestPlan.plan_json.selectedOptionId) ?? null,
      actions: latestPlan.plan_json.actions,
      questions: latestPlan.plan_json.questions,
      successMetrics: latestPlan.plan_json.successMetrics,
      guardrails: latestPlan.plan_json.guardrails,
      review: latestReview?.plan_version_id === latestPlan.id && latestReview.plan_hash === latestPlan.plan_hash
        ? latestReview
        : null,
      deliverable: latestDeliverable?.plan_version_id === latestPlan.id && latestDeliverable.plan_hash === latestPlan.plan_hash
        ? {
            id: latestDeliverable.id,
            version: latestDeliverable.version,
            documentHash: latestDeliverable.document_hash,
            document: latestDeliverable.document_json,
            review: latestDeliverableReview?.deliverable_version_id === latestDeliverable.id
              && latestDeliverableReview.document_hash === latestDeliverable.document_hash
              ? latestDeliverableReview
              : null,
            activation: activation?.deliverable_version_id === latestDeliverable.id
              && activation.document_hash === latestDeliverable.document_hash
              ? {
                  ...activation,
                  outcome: activationOutcome?.activation_id === activation.id
                    && activationOutcome.document_hash === activation.document_hash
                    ? activationOutcome
                    : null,
                }
              : null,
          }
        : null,
    } : null,
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
  const refreshed = await planningContext(user.businessId, id);
  return NextResponse.json({
    success: true,
    thread: refreshed?.thread ?? null,
    latestPlan: refreshed?.latestPlan ?? null,
    created: result.created,
  }, { status: result.created ? 201 : 200 });
}