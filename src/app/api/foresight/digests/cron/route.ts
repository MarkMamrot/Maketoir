import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { ForesightDigestService } from '@/lib/foresight/ForesightDigestService';
import { ForesightOutcomeService } from '@/lib/foresight/ForesightOutcomeService';
import { DEFAULT_BUSINESS_TIME_ZONE, getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { query } from '@/services/MySQLService';

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { digestType?: unknown };
  const digestType = body.digestType ?? 'daily_operations';
  if (digestType !== 'daily_operations' && digestType !== 'weekly_summary') {
    return NextResponse.json({ error: 'Invalid digestType.' }, { status: 400 });
  }

  const businesses = await query<{ business_id: string }>(
    `SELECT business_id FROM businesses
     WHERE deleted_at IS NULL ORDER BY business_id`,
  );
  const results: Array<{
    businessId: string;
    digestDate?: string;
    itemCount?: number;
    measuredOutcomes?: number;
    deferredOutcomes?: number;
    error?: string;
  }> = [];
  for (const { business_id: businessId } of businesses) {
    try {
      const timeZone = await runImsForBusiness(
        businessId,
        () => getBusinessTimeZone(businessId),
      ).catch(() => DEFAULT_BUSINESS_TIME_ZONE);
      const today = new Date().toLocaleDateString('sv-SE', { timeZone });
      const digestDate = digestType === 'weekly_summary' ? addDays(today, -1) : today;
      const outcomes = digestType === 'daily_operations'
        ? await runImsForBusiness(
          businessId,
          () => ForesightOutcomeService.evaluateDuePaidMedia(businessId, addDays(today, -1)),
        )
        : null;
      const digest = digestType === 'weekly_summary'
        ? await ForesightDigestService.generateWeekly(businessId, digestDate)
        : await ForesightDigestService.generateDaily(businessId, digestDate);
      const itemCount = digestType === 'weekly_summary' ? digest.notices.length : digest.counts.total;
      results.push({
        businessId,
        digestDate,
        itemCount,
        measuredOutcomes: outcomes?.measuredCount,
        deferredOutcomes: outcomes?.deferredCount,
      });
    } catch (error) {
      results.push({ businessId, error: error instanceof Error ? error.message : 'Digest generation failed.' });
    }
  }
  const failed = results.filter((result) => result.error).length;
  return NextResponse.json(
    { success: failed === 0, digestType, businesses: businesses.length, generated: businesses.length - failed, failed, results },
    { status: failed === 0 ? 200 : 207 },
  );
}