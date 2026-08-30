import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { listAllowedModelsForBusiness } from '@/lib/ai/billing/commercialModels';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    return NextResponse.json({ models: await listAllowedModelsForBusiness(session.businessId, 'video') });
  } catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'ai_billing', operation: 'list_allowed_video_models', title: 'Allowed AI video models could not be loaded', error });
    return NextResponse.json({ error: 'Available AI models could not be loaded.' }, { status: 500 });
  }
}