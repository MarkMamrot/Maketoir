import { NextResponse } from 'next/server';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';
import { ForesightRecommendationService } from '@/lib/foresight/ForesightRecommendationService';
import { KlaviyoRecommendationService } from '@/lib/foresight/KlaviyoRecommendationService';
import { ForesightOutcomeService } from '@/lib/foresight/ForesightOutcomeService';
import { Ga4RecommendationService } from '@/lib/foresight/Ga4RecommendationService';
import { ForesightRepository } from '@/lib/foresight/repositories/ForesightRepository';
import { ForesightExecutionRepository } from '@/lib/foresight/repositories/ForesightExecutionRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { DEFAULT_BUSINESS_TIME_ZONE, getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { DEFAULT_FORESIGHT_MARKETING_STRATEGY, parseMarketingStrategy } from '@/lib/foresight/marketingStrategy';

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function yesterdayUtc(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const [recommendations, storedStrategy] = await Promise.all([
    ForesightRepository.listRecommendations(user.businessId, [
      'shadow',
      'pending_approval',
      'approved',
      'executing',
      'succeeded',
      'failed',
      'compensated',
      'rejected',
    ]),
    ForesightRepository.latestStrategy(user.businessId),
  ]);
  const strategy = storedStrategy
    ? parseMarketingStrategy(storedStrategy.strategy_json)
    : DEFAULT_FORESIGHT_MARKETING_STRATEGY;
  const recommendationIds = recommendations.map((recommendation) => recommendation.id);
  const timeZone = await runImsForBusiness(
    user.businessId,
    () => getBusinessTimeZone(user.businessId),
  ).catch(() => DEFAULT_BUSINESS_TIME_ZONE);
  const businessToday = new Date().toLocaleDateString('sv-SE', { timeZone });
  const [events, outcomes, implementations, executions] = await Promise.all([
    ForesightRepository.listRecommendationEvents(user.businessId, recommendationIds),
    ForesightRepository.listRecommendationOutcomes(user.businessId, recommendationIds),
    ForesightRepository.listRecommendationImplementations(user.businessId, recommendationIds),
    ForesightExecutionRepository.listForRecommendations(user.businessId, recommendationIds),
  ]);
  return NextResponse.json({
    success: true,
    recommendations,
    events,
    outcomes,
    implementations,
    executions,
    businessToday,
    paidMediaPolicy: strategy.paidMedia,
  });
}

export async function POST(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;

  const body = await request.json().catch(() => ({})) as { through?: unknown };
  const through = body.through ?? yesterdayUtc();
  if (!isIsoDate(through)) {
    return NextResponse.json({ error: 'through must be a valid YYYY-MM-DD date.' }, { status: 400 });
  }

  const [paidMedia, ga4, klaviyo] = await Promise.all([
    ForesightRecommendationService.evaluatePaidMedia(user.businessId, through),
    Ga4RecommendationService.evaluateChannels(user.businessId, through),
    KlaviyoRecommendationService.evaluateLifecycle(user.businessId, through),
  ]);
  const [outcomes, campaignOutcomes] = await Promise.all([
    ForesightOutcomeService.evaluateDuePaidMedia(user.businessId, through),
    ForesightOutcomeService.evaluateDueCampaigns(user.businessId, through),
  ]);
  return NextResponse.json({
    success: true,
    recommendationCount: paidMedia.recommendationCount + ga4.recommendationCount + klaviyo.recommendationCount,
    expiredCount: paidMedia.expiredCount + ga4.expiredCount + klaviyo.expiredCount,
    paidMedia,
    ga4,
    klaviyo,
    outcomes,
    campaignOutcomes,
  });
}