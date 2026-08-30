import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import {
  BUSINESS_AI_MODEL_COLUMNS,
  getBusinessAiModelPreferences,
  validateBusinessAiModelPreferences,
} from '@/lib/ai/businessModelPreferences';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { listAllowedModelsForBusiness } from '@/lib/ai/billing/commercialModels';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const connection = await ConnectionsRepository.get(session.businessId);
    return NextResponse.json({ success: true, models: getBusinessAiModelPreferences(connection) });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims',
      operation: 'ai_model_settings_load',
      error,
    });
    return NextResponse.json({ error: 'AI model settings could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const models = validateBusinessAiModelPreferences(body?.models);
    if (!models) {
      return NextResponse.json({ error: 'Choose a valid Gemini text model for every AI function.' }, { status: 400 });
    }
    const allowed = new Set((await listAllowedModelsForBusiness(session.businessId, 'text')).map(model => model.id));
    if (Object.values(models).some(modelId => !allowed.has(modelId))) {
      return NextResponse.json({ error: 'Choose an allowed model with active provider pricing for every AI function.' }, { status: 400 });
    }

    await ConnectionsRepository.upsert(session.businessId, Object.fromEntries(
      Object.entries(BUSINESS_AI_MODEL_COLUMNS).map(([key, column]) => [column, models[key as keyof typeof models]]),
    ));
    return NextResponse.json({ success: true, models });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims',
      operation: 'ai_model_settings_save',
      error,
    });
    return NextResponse.json({ error: 'AI model settings could not be saved.' }, { status: 500 });
  }
}