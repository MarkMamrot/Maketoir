import { NextResponse } from 'next/server';
import { AiRateRepository, parseMarkupBasisPoints } from '@/lib/ai/billing/rateRepository';
import { AI_PLAN_KEYS } from '@/lib/ai/billing/types';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  const markups = body?.markups;
  if (!markups || typeof markups !== 'object' || Array.isArray(markups)) return NextResponse.json({ error: 'Plan markups are required.' }, { status: 400 });
  const selected = Object.entries(markups).filter(([, value]) => String(value ?? '').trim() !== '');
  try {
    if (!selected.length) throw new Error('Enter a markup for at least one plan.');
    for (const [planKey, value] of selected) {
      if (!AI_PLAN_KEYS.includes(planKey as (typeof AI_PLAN_KEYS)[number])) throw new Error('Invalid plan.');
      parseMarkupBasisPoints(value);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid plan markups.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, ...(await AiRateRepository.applyPlanMarkups(markups, auth.user.userId)) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: '__solvantis_platform__', source: 'ai_billing', operation: 'apply_plan_rate_markups', title: 'AI plan markup update failed', error, context: { plan_count: selected.length } });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Plan markup update failed.' }, { status: 500 });
  }
}