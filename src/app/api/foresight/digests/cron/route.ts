import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { ForesightDigestService } from '@/lib/foresight/ForesightDigestService';
import { DEFAULT_BUSINESS_TIME_ZONE, getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { query } from '@/services/MySQLService';

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const businesses = await query<{ business_id: string }>(
    `SELECT business_id FROM businesses
     WHERE deleted_at IS NULL ORDER BY business_id`,
  );
  const results: Array<{ businessId: string; digestDate?: string; itemCount?: number; error?: string }> = [];
  for (const { business_id: businessId } of businesses) {
    try {
      const timeZone = await runImsForBusiness(
        businessId,
        () => getBusinessTimeZone(businessId),
      ).catch(() => DEFAULT_BUSINESS_TIME_ZONE);
      const digestDate = new Date().toLocaleDateString('sv-SE', { timeZone });
      const digest = await ForesightDigestService.generateDaily(businessId, digestDate);
      results.push({ businessId, digestDate, itemCount: digest.counts.total });
    } catch (error) {
      results.push({ businessId, error: error instanceof Error ? error.message : 'Digest generation failed.' });
    }
  }
  const failed = results.filter((result) => result.error).length;
  return NextResponse.json(
    { success: failed === 0, businesses: businesses.length, generated: businesses.length - failed, failed, results },
    { status: failed === 0 ? 200 : 207 },
  );
}