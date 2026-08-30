import { NextResponse } from 'next/server';
import { AiRateRepository } from '@/lib/ai/billing/rateRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';

export async function PATCH(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  const modelId = typeof body?.modelId === 'string' ? body.modelId.trim() : '';
  if (!modelId || typeof body?.allowed !== 'boolean') return NextResponse.json({ error: 'Model ID and allowed status are required.' }, { status: 400 });
  try {
    await AiRateRepository.setModelAllowed(modelId, body.allowed);
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({ businessId: '__solvantis_platform__', source: 'ai_billing', operation: 'set_allowed_provider_model', title: 'Provider model availability update failed', error, context: { model_id: modelId, allowed: body.allowed } });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Model availability update failed.' }, { status: 500 });
  }
}