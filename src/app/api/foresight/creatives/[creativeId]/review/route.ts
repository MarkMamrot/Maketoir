import { NextResponse } from 'next/server';
import { createGeminiPlannerModelGateway } from '@/lib/foresight/assistant/PlannerModelGateway';
import { CreativeBriefValidationError } from '@/lib/foresight/creative/creativeBrief';
import { ForesightCreativeBriefService } from '@/lib/foresight/creative/ForesightCreativeBriefService';
import { diagnoseCreativePerformance } from '@/lib/foresight/creative/creativeDiagnostics';
import { ForesightCreativeBriefRepository, CreativeBriefTransitionError } from '@/lib/foresight/repositories/ForesightCreativeBriefRepository';
import { ForesightCreativeRepository } from '@/lib/foresight/repositories/ForesightCreativeRepository';
import { PlanningThreadConflictError } from '@/lib/foresight/repositories/ForesightPlanningRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function id(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function reviewContext(businessId: string, creativeId: number, throughDate: string) {
  const creative = await ForesightCreativeRepository.get(businessId, creativeId);
  if (!creative) return null;
  const [assessment, thread, diagnosticInputs, latestBrief] = await Promise.all([
    ForesightCreativeRepository.latestAssessment(businessId, creativeId),
    ForesightCreativeBriefRepository.getThread(businessId, creativeId),
    ForesightCreativeRepository.listDiagnosticInputs(businessId, addDays(throughDate, -13), throughDate, 100),
    ForesightCreativeBriefRepository.latest(businessId, creativeId),
  ]);
  const [messages, humanContext, latestReview] = thread ? await Promise.all([
    ForesightCreativeBriefRepository.listMessages(businessId, thread.id),
    ForesightCreativeBriefRepository.latestHumanContext(businessId, thread.id),
    ForesightCreativeBriefRepository.latestReview(businessId, thread.id),
  ]) : [[], null, null];
  const diagnostics = diagnoseCreativePerformance({ throughDate, creatives: diagnosticInputs });
  return { creative, assessment, thread, messages, humanContext, diagnostics, latestBrief, latestReview,
    mediaUrl: `/api/foresight/creatives/${creativeId}/media` };
}

export async function GET(request: Request, context: { params: { creativeId: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const creativeId = id(context.params.creativeId);
  if (creativeId == null) return NextResponse.json({ error: 'Invalid creative id.' }, { status: 400 });
  const throughDate = new URL(request.url).searchParams.get('through');
  if (!isoDate(throughDate)) return NextResponse.json({ error: 'through must be a valid complete-day YYYY-MM-DD date.' }, { status: 400 });
  const result = await reviewContext(user.businessId, creativeId, throughDate);
  return result ? NextResponse.json({ success: true, ...result }) : NextResponse.json({ error: 'Creative not found.' }, { status: 404 });
}

export async function POST(request: Request, context: { params: { creativeId: string } }) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const creativeId = id(context.params.creativeId);
  if (creativeId == null) return NextResponse.json({ error: 'Invalid creative id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const operation = body?.operation;
  try {
    if (operation === 'start') {
      const creative = await ForesightCreativeRepository.get(user.businessId, creativeId);
      if (!creative) return NextResponse.json({ error: 'Creative not found.' }, { status: 404 });
      const result = await ForesightCreativeBriefRepository.getOrCreateReviewThread(user.businessId, creativeId, {
        title: `Creative Review: ${creative.name}`.slice(0, 200), createdBy: user.userId,
      });
      return NextResponse.json({ success: true, ...result }, { status: result.created ? 201 : 200 });
    }
    const threadId = Number(body?.threadId);
    if (!Number.isSafeInteger(threadId) || threadId <= 0) {
      return NextResponse.json({ error: 'threadId must be a positive integer.' }, { status: 400 });
    }
    if (operation === 'review') {
      const briefVersionId = Number(body?.briefVersionId);
      const documentHash = typeof body?.documentHash === 'string' ? body.documentHash.trim() : '';
      const action = body?.action;
      if (!Number.isSafeInteger(briefVersionId) || briefVersionId <= 0 || !/^[a-f0-9]{64}$/.test(documentHash)
        || !['accepted', 'rejected', 'revision_requested'].includes(String(action))) {
        return NextResponse.json({ error: 'briefVersionId, documentHash, and a valid review action are required.' }, { status: 400 });
      }
      const reviewId = await ForesightCreativeBriefRepository.review(user.businessId, creativeId, threadId, {
        briefVersionId, documentHash, action: action as 'accepted' | 'rejected' | 'revision_requested',
        actorId: user.userId, note: typeof body?.note === 'string' ? body.note : null,
      });
      return NextResponse.json({ success: true, reviewId }, { status: 201 });
    }
    const expectedRevision = Number(body?.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      return NextResponse.json({ error: 'expectedRevision must be a positive integer.' }, { status: 400 });
    }
    if (operation === 'context') {
      const revision = await ForesightCreativeBriefRepository.recordHumanContext(
        user.businessId, creativeId, threadId, expectedRevision,
        { actorUserId: user.userId, context: body?.context },
      );
      return NextResponse.json({ success: true, revision });
    }
    if (operation === 'generate') {
      if (!isoDate(body?.diagnosticsThrough)) return NextResponse.json({ error: 'diagnosticsThrough must be a valid complete-day YYYY-MM-DD date.' }, { status: 400 });
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return NextResponse.json({ error: 'Creative brief AI is not configured.' }, { status: 503 });
      const modelId = process.env.FORESIGHT_CREATIVE_MODEL?.trim() || process.env.FORESIGHT_PLANNER_MODEL?.trim() || 'gemini-2.5-flash';
      const brief = await ForesightCreativeBriefService.generate({
        businessId: user.businessId, creativeId, threadId, expectedRevision,
        diagnosticsThrough: body.diagnosticsThrough, actorUserId: user.userId,
        modelId, model: createGeminiPlannerModelGateway(apiKey),
        changeReason: typeof body.changeReason === 'string' ? body.changeReason : null,
      });
      return NextResponse.json({ success: true, brief }, { status: 201 });
    }
    return NextResponse.json({ error: 'operation must be start, context, generate, or review.' }, { status: 400 });
  } catch (error) {
    if (error instanceof PlanningThreadConflictError) return NextResponse.json({ error: error.message, code: 'THREAD_CONFLICT' }, { status: 409 });
    if (error instanceof CreativeBriefTransitionError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof CreativeBriefValidationError) {
      return NextResponse.json({ error: 'The model returned an invalid creative brief.', code: 'INVALID_CREATIVE_BRIEF', issues: error.issues }, { status: 422 });
    }
    throw error;
  }
}
