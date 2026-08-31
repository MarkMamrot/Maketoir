import { NextResponse } from 'next/server';
import { AiRateRepository } from '@/lib/ai/billing/rateRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { refreshGoogleModelCatalog } from '@/lib/ai/billing/modelCatalogSync';

async function failure(error: unknown, operation: string) {
  await reportRuntimeIssue({ businessId: '__solvantis_platform__', source: 'google_cloud_billing', operation, title: 'Google AI pricing synchronization failed', error });
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Google pricing synchronization failed.' }, { status: 503 });
}

export async function GET() {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    const { preview } = await refreshGoogleModelCatalog();
    return NextResponse.json({ ...preview, candidates: await AiRateRepository.compareGoogle(preview.candidates) });
  } catch (error) { return failure(error, 'preview_google_ai_rates'); }
}

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const selectedIds = Array.isArray(body.candidateIds) ? [...new Set(body.candidateIds.map(String))] : [];
    if (!selectedIds.length || selectedIds.length > 100) return NextResponse.json({ error: 'Select between 1 and 100 rates.' }, { status: 400 });
    const { preview } = await refreshGoogleModelCatalog();
    const candidates = preview.candidates.filter(candidate => selectedIds.includes(candidate.id));
    if (candidates.length !== selectedIds.length) return NextResponse.json({ error: 'Google pricing changed since preview. Refresh and review it again.' }, { status: 409 });
    return NextResponse.json({ success: true, ...(await AiRateRepository.importGoogle(candidates, auth.user.userId)) });
  } catch (error) { return failure(error, 'import_google_ai_rates'); }
}