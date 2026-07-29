import { NextResponse } from 'next/server';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';
import { ForesightRecommendationService } from '@/lib/foresight/ForesightRecommendationService';
import { KlaviyoRecommendationService } from '@/lib/foresight/KlaviyoRecommendationService';
import { ForesightRepository } from '@/lib/foresight/repositories/ForesightRepository';

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

  const recommendations = await ForesightRepository.listRecommendations(user.businessId, [
    'shadow',
    'pending_approval',
    'approved',
  ]);
  const events = await ForesightRepository.listRecommendationEvents(
    user.businessId,
    recommendations.map((recommendation) => recommendation.id),
  );
  return NextResponse.json({ success: true, recommendations, events });
}

export async function POST(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;

  const body = await request.json().catch(() => ({})) as { through?: unknown };
  const through = body.through ?? yesterdayUtc();
  if (!isIsoDate(through)) {
    return NextResponse.json({ error: 'through must be a valid YYYY-MM-DD date.' }, { status: 400 });
  }

  const [paidMedia, klaviyo] = await Promise.all([
    ForesightRecommendationService.evaluatePaidMedia(user.businessId, through),
    KlaviyoRecommendationService.evaluateLifecycle(user.businessId, through),
  ]);
  return NextResponse.json({
    success: true,
    recommendationCount: paidMedia.recommendationCount + klaviyo.recommendationCount,
    expiredCount: paidMedia.expiredCount + klaviyo.expiredCount,
    paidMedia,
    klaviyo,
  });
}