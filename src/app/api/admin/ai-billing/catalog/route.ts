import { NextResponse } from 'next/server';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { AiModelCatalogRepository } from '@/lib/ai/billing/modelCatalogRepository';
import { refreshGoogleModelCatalog } from '@/lib/ai/billing/modelCatalogSync';

async function failure(error: unknown, operation: string) {
  await reportRuntimeIssue({ businessId: '__solvantis_platform__', source: 'ai_model_catalog', operation, title: 'AI model catalog operation failed', error });
  return NextResponse.json({ error: error instanceof Error ? error.message : 'AI model catalog operation failed.' }, { status: 500 });
}

export async function GET() {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try { return NextResponse.json(await AiModelCatalogRepository.list()); }
  catch (error) { return failure(error, 'list_model_reconciliation'); }
}

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    if (body?.action === 'discover') {
      const result = await refreshGoogleModelCatalog();
      return NextResponse.json({ success: true, discovered: result.discovered, observed: result.observed });
    }
    if (body?.action === 'map') {
      const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
      const familyPattern = typeof body.familyPattern === 'string' ? body.familyPattern.trim() : '';
      const matchType = body.matchType === 'regex' ? 'regex' : body.matchType === 'contains' ? 'contains' : null;
      if (!modelId || !familyPattern || !matchType) return NextResponse.json({ error: 'Model, family pattern, and match type are required.' }, { status: 400 });
      return NextResponse.json({ success: true, mapping: await AiModelCatalogRepository.saveMapping({ modelId, familyPattern, matchType }, auth.user.userId) });
    }
    return NextResponse.json({ error: 'Unsupported catalog action.' }, { status: 400 });
  } catch (error) { return failure(error, body?.action === 'map' ? 'create_billing_family_mapping' : 'discover_google_models'); }
}

export async function PATCH(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  const mappingId = Number(body?.mappingId);
  if (!Number.isSafeInteger(mappingId) || mappingId < 1) return NextResponse.json({ error: 'A valid mapping ID is required.' }, { status: 400 });
  try {
    await AiModelCatalogRepository.deactivateMapping(mappingId, auth.user.userId);
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error, 'deactivate_billing_family_mapping'); }
}