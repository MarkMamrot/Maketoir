import { NextResponse } from 'next/server';
import { createGeminiPlannerModelGateway } from '@/lib/foresight/assistant/PlannerModelGateway';
import { CreativeAssessmentValidationError } from '@/lib/foresight/creative/creativeAssessment';
import { ForesightCreativeAssessmentService } from '@/lib/foresight/creative/ForesightCreativeAssessmentService';
import { ForesightCreativeRepository } from '@/lib/foresight/repositories/ForesightCreativeRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function creativeId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(_request: Request, context: { params: { creativeId: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const id = creativeId(context.params.creativeId);
  if (id == null) return NextResponse.json({ error: 'Invalid creative id.' }, { status: 400 });
  const creative = await ForesightCreativeRepository.get(user.businessId, id);
  if (!creative) return NextResponse.json({ error: 'Creative not found.' }, { status: 404 });
  const assessment = await ForesightCreativeRepository.latestAssessment(user.businessId, id);
  return NextResponse.json({ success: true, creative, assessment });
}

export async function POST(_request: Request, context: { params: { creativeId: string } }) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const id = creativeId(context.params.creativeId);
  if (id == null) return NextResponse.json({ error: 'Invalid creative id.' }, { status: 400 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Creative assessment AI is not configured.' }, { status: 503 });
  const modelId = process.env.FORESIGHT_CREATIVE_MODEL?.trim()
    || process.env.FORESIGHT_PLANNER_MODEL?.trim()
    || 'gemini-2.5-flash';
  try {
    const assessment = await ForesightCreativeAssessmentService.assess({
      businessId: user.businessId, creativeId: id, actorUserId: user.userId,
      modelId, model: createGeminiPlannerModelGateway(apiKey, { businessId: user.businessId, area: 'foresight', operation: 'assess_creative', actorType: 'user', actorUserId: user.userId, referenceType: 'creative', referenceId: id }),
    });
    return NextResponse.json({ success: true, assessment }, { status: 201 });
  } catch (error) {
    if (error instanceof CreativeAssessmentValidationError) {
      return NextResponse.json({ error: 'The model returned an invalid creative assessment.',
        code: 'INVALID_CREATIVE_ASSESSMENT', issues: error.issues }, { status: 422 });
    }
    if (error instanceof Error && error.message === 'Creative not found.') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
