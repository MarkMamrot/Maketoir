import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { listAllowedModelsForBusiness } from '@/lib/ai/billing/commercialModels';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const allowed = await listAllowedModelsForBusiness(session.businessId, 'text');
    const models = allowed.map(model => ({ id: model.id, name: model.displayName }));
    return NextResponse.json({ models });
  } catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'ai_billing', operation: 'list_allowed_gemini_models', title: 'Allowed Gemini models could not be loaded', error });
    return NextResponse.json({ error: 'Available AI models could not be loaded.' }, { status: 500 });
  }
}
