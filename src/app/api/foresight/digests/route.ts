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

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const [digests, weeklyDigests] = await Promise.all([
    ForesightDigestService.listRecent(user.businessId, 7),
    ForesightDigestService.listRecentWeekly(user.businessId, 8),
  ]);
  return NextResponse.json({ success: true, digests, weeklyDigests });
}

export async function POST(request?: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const body = request ? await request.json().catch(() => ({})) as { digestType?: unknown } : {};
  const digestType = body.digestType ?? 'daily_operations';
  if (digestType !== 'daily_operations' && digestType !== 'weekly_summary') {
    return NextResponse.json({ error: 'digestType must be daily_operations or weekly_summary.' }, { status: 400 });
  }
  const today = await businessDate(user.businessId);
  const digestDate = digestType === 'weekly_summary' ? addDays(today, -1) : today;
  const digest = digestType === 'weekly_summary'
    ? await ForesightDigestService.generateWeekly(user.businessId, digestDate)
    : await ForesightDigestService.generateDaily(user.businessId, digestDate);
  return NextResponse.json({ success: true, digest });
}