import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { loadCreativeMediaEvidence } from '@/lib/foresight/creative/ForesightCreativeAssessmentService';
import { ForesightCreativeRepository } from '@/lib/foresight/repositories/ForesightCreativeRepository';

export async function GET(_request: Request, context: { params: { creativeId: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const creativeId = Number(context.params.creativeId);
  if (!Number.isSafeInteger(creativeId) || creativeId <= 0) {
    return NextResponse.json({ error: 'Invalid creative id.' }, { status: 400 });
  }
  const creative = await ForesightCreativeRepository.get(user.businessId, creativeId);
  if (!creative) return NextResponse.json({ error: 'Creative not found.' }, { status: 404 });
  try {
    const media = await loadCreativeMediaEvidence(user.businessId, creative);
    if (!media) return NextResponse.json({ error: 'No reviewable image is available for this creative.' }, { status: 404 });
    return new Response(Buffer.from(media.data, 'base64'), {
      headers: {
        'Content-Type': media.mimeType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    await reportRuntimeIssue({ businessId: user.businessId, source: 'CreativeReviewMediaRoute',
      operation: 'load_creative_media', severity: 'warning', title: 'Creative Review media could not be loaded', error,
      reference: { type: 'foresight_creative', id: creativeId }, context: { source: creative.source } }).catch(() => undefined);
    return NextResponse.json({ error: 'Creative media is temporarily unavailable.' }, { status: 502 });
  }
}
