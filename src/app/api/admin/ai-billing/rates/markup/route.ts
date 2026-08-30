import { NextResponse } from 'next/server';
import { AiRateRepository, parseMarkupBasisPoints } from '@/lib/ai/billing/rateRepository';
import { AI_PLAN_KEYS } from '@/lib/ai/billing/types';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  const settings = body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return NextResponse.json({ error: 'Plan pricing settings are required.' }, { status: 400 });
  try {
    for (const [planKey, value] of Object.entries(settings) as Array<[string, any]>) {
      if (!AI_PLAN_KEYS.includes(planKey as (typeof AI_PLAN_KEYS)[number])) throw new Error('Invalid plan.');
      if (!['rates', 'markup'].includes(value?.pricingMode)) throw new Error('Choose sell rates or flat markup for every changed plan.');
      parseMarkupBasisPoints(value?.markupPercent ?? '0');
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid plan pricing.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, ...(await AiRateRepository.savePlanPricing(settings)) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: '__solvantis_platform__', source: 'ai_billing', operation: 'save_plan_pricing', title: 'AI plan pricing update failed', error, context: { plan_count: Object.keys(settings).length } });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Plan pricing update failed.' }, { status: 500 });
  }
}