import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { DEFAULT_BUSINESS_TIME_ZONE, getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import {
  CampaignActivationValidationError,
  ForesightCampaignActivationRepository,
  type CampaignActivationChannel,
} from '@/lib/foresight/repositories/ForesightCampaignActivationRepository';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

function threadId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function businessToday(businessId: string): Promise<string> {
  const timeZone = await runImsForBusiness(
    businessId,
    () => getBusinessTimeZone(businessId),
  ).catch(() => DEFAULT_BUSINESS_TIME_ZONE);
  return new Date().toLocaleDateString('sv-SE', { timeZone });
}

export async function GET(_request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const id = threadId(context.params.threadId);
  if (id == null) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const activation = await ForesightCampaignActivationRepository.getForThread(user.businessId, id);
  return NextResponse.json({ success: true, activation });
}

export async function POST(request: Request, context: { params: { threadId: string } }) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const id = threadId(context.params.threadId);
  if (id == null) return NextResponse.json({ error: 'Invalid thread id.' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const deliverableVersionId = Number(body?.deliverableVersionId);
  const documentHash = typeof body?.documentHash === 'string' ? body.documentHash.trim() : '';
  if (!Number.isInteger(deliverableVersionId) || deliverableVersionId <= 0 || !/^[a-f0-9]{64}$/.test(documentHash)) {
    return NextResponse.json({ error: 'An exact deliverable version and hash are required.' }, { status: 400 });
  }
  try {
    const activation = await ForesightCampaignActivationRepository.create(user.businessId, id, {
      deliverableVersionId,
      documentHash,
      activatedOn: typeof body?.activatedOn === 'string' ? body.activatedOn : '',
      businessToday: await businessToday(user.businessId),
      channels: Array.isArray(body?.channels) ? body.channels as CampaignActivationChannel[] : [],
      destinationUrl: typeof body?.destinationUrl === 'string' ? body.destinationUrl : null,
      utm: body?.utm && typeof body.utm === 'object' && !Array.isArray(body.utm)
        ? body.utm as Record<string, string>
        : {},
      assetIds: Array.isArray(body?.assetIds) ? body.assetIds.filter((value): value is string => typeof value === 'string') : [],
      publishedDetails: typeof body?.publishedDetails === 'string' ? body.publishedDetails : '',
      deviationsText: typeof body?.deviationsText === 'string' ? body.deviationsText : null,
      operatorNote: typeof body?.operatorNote === 'string' ? body.operatorNote : '',
      horizonDays: 7,
      activatedBy: user.userId,
    });
    return NextResponse.json({ success: true, activation }, { status: 201 });
  } catch (error) {
    if (error instanceof CampaignActivationValidationError) {
      return NextResponse.json({ error: error.message, code: 'ACTIVATION_REJECTED' }, { status: 422 });
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'Activation has already been recorded for this deliverable package.', code: 'ACTIVATION_EXISTS' }, { status: 422 });
    }
    throw error;
  }
}