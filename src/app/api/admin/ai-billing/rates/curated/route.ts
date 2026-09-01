import { NextResponse } from 'next/server';

import { CuratedPricingRepository } from '@/lib/ai/billing/curatedPricingRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';

export async function GET() {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await CuratedPricingRepository.get());
  } catch (error) {
    await reportRuntimeIssue({ businessId: '__solvantis_platform__', source: 'ai_billing', operation: 'read_curated_pricing', title: 'Curated AI pricing could not be loaded', error });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Curated AI pricing could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json({ success: true, ...(await CuratedPricingRepository.save(body || {}, auth.user.userId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Curated AI pricing could not be saved.';
    if (/must be|markup|enter a markup/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    await reportRuntimeIssue({ businessId: '__solvantis_platform__', source: 'ai_billing', operation: 'save_curated_pricing', title: 'Curated AI pricing could not be saved', error });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}