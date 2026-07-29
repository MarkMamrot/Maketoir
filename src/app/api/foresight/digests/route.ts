import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { ForesightDigestService } from '@/lib/foresight/ForesightDigestService';
import { DEFAULT_BUSINESS_TIME_ZONE, getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { requireAdminSession, requireAdminTier } from '@/lib/sessionUtils';

async function businessDate(businessId: string): Promise<string> {
  const timeZone = await runImsForBusiness(
    businessId,
    () => getBusinessTimeZone(businessId),
  ).catch(() => DEFAULT_BUSINESS_TIME_ZONE);
  return new Date().toLocaleDateString('sv-SE', { timeZone });
}

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const digests = await ForesightDigestService.listRecent(user.businessId, 7);
  return NextResponse.json({ success: true, digests });
}

export async function POST() {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const digestDate = await businessDate(user.businessId);
  const digest = await ForesightDigestService.generateDaily(user.businessId, digestDate);
  return NextResponse.json({ success: true, digest });
}