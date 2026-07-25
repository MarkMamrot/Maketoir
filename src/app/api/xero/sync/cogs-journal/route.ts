/**
 * POST /api/xero/sync/cogs-journal
 * Body: { databaseId, month: 'YYYY-MM' }
 *
 * Compatibility endpoint for posting a completed monthly COGS period.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { getLastCompletedCogsPeriod, getMonthlyCogsPeriod } from '@/lib/xero/cogsPeriods';
import { postCogsPeriod } from '@/services/XeroCogsService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId, month, overrideReason } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'month is required (format: YYYY-MM).' }, { status: 400 });
  }

  try {
    const period = getMonthlyCogsPeriod(month);
    const lastCompleted = getLastCompletedCogsPeriod(
      'monthly',
      new Date(),
      process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney',
    );
    if (period.endDateExclusive > lastCompleted.endDateExclusive) {
      return NextResponse.json({ error: 'Only completed calendar months can be posted.' }, { status: 400 });
    }

    const result = await postCogsPeriod({ businessId: databaseId, period, overrideReason });
    if (result.outcome === 'blocked') return NextResponse.json(result, { status: 422 });
    if (result.outcome === 'failed') return NextResponse.json(result, { status: 502 });
    if (result.outcome === 'unknown') return NextResponse.json(result, { status: 202 });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[xero/sync/cogs-journal]', err?.message ?? err);
    return NextResponse.json({ error: 'COGS journal sync failed.' }, { status: 500 });
  }
}
