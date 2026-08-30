/**
 * GET /api/ai/image-models
 * Returns available image generation models from the Google AI API.
 * Filters to models whose name contains 'image' (Nano Banana family + Imagen).
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { listAllowedModelsForBusiness } from '@/lib/ai/billing/commercialModels';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    return NextResponse.json({ models: await listAllowedModelsForBusiness(session.businessId, 'image') });
  } catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'ai_billing', operation: 'list_allowed_image_models', title: 'Allowed AI image models could not be loaded', error });
    return NextResponse.json({ error: 'Available AI models could not be loaded.' }, { status: 500 });
  }
}
