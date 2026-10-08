import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { CogsFrequency, getCogsPeriodStartingAt, getLastCompletedCogsPeriod } from '@/lib/xero/cogsPeriods';
import { assertXeroPostingEnabled, isXeroPostingDisabledError } from '@/lib/xero/postingPolicy';
import { postCogsPeriod } from '@/services/XeroCogsService';
import { getXeroSyncAccessDenied } from '@/lib/xero/advisorSyncAccess';
import { query } from '@/services/MySQLService';

const FREQUENCIES = new Set<CogsFrequency>(['daily', 'weekly', 'monthly', 'quarterly']);

class CogsPeriodRequestError extends Error {}

function dateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  try {
    const body = await req.json();
    const databaseId = String(body.databaseId ?? '');
    const frequency = String(body.frequency ?? 'monthly') as CogsFrequency;
    const overrideReason = typeof body.overrideReason === 'string' ? body.overrideReason : undefined;
    const startDate = typeof body.startDate === 'string' ? body.startDate.trim() : '';
    const endDateExclusive = typeof body.endDateExclusive === 'string' ? body.endDateExclusive.trim() : '';

    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;
    const syncDenied = await getXeroSyncAccessDenied(user);
    if (syncDenied) return syncDenied;
    if (user.tier === 'Advisor' && body.overrideReason !== undefined) {
      return NextResponse.json({ error: 'Advisors cannot override valuation checks.' }, { status: 403 });
    }
    await assertXeroPostingEnabled(databaseId);
    if (!FREQUENCIES.has(frequency)) {
      return NextResponse.json({ error: 'Frequency must be daily, weekly, monthly, or quarterly.' }, { status: 400 });
    }
    const result = await runImsForBusiness(databaseId, async () => {
      const timeZone = await getBusinessTimeZone(databaseId);
      const lastCompleted = getLastCompletedCogsPeriod(frequency, new Date(), timeZone);
      let period = lastCompleted;
      if (startDate || endDateExclusive) {
        if (!startDate || !endDateExclusive) {
          throw new CogsPeriodRequestError('Both startDate and endDateExclusive are required for a historical period.');
        }
        try {
          period = getCogsPeriodStartingAt(frequency, startDate);
        } catch (error: unknown) {
          throw new CogsPeriodRequestError(error instanceof Error ? error.message : 'Invalid COGS period.');
        }
        if (period.endDateExclusive !== endDateExclusive) {
          throw new CogsPeriodRequestError(`The selected dates do not form one complete ${frequency} COGS period.`);
        }
        if (period.endDateExclusive > lastCompleted.endDateExclusive) {
          throw new CogsPeriodRequestError('Only completed COGS periods can be posted.');
        }
        const settings = await query<{ reliable_from: string | Date | null }>(
          'SELECT reliable_from FROM xero_cogs_settings WHERE business_id = ? LIMIT 1',
          [databaseId],
        );
        const reliableFrom = dateString(settings[0]?.reliable_from);
        if (reliableFrom && period.startDate < reliableFrom) {
          throw new CogsPeriodRequestError(`The selected period starts before reliable COGS records begin on ${reliableFrom}.`);
        }
      }
      return postCogsPeriod({ businessId: databaseId, period, overrideReason });
    });
    if (result.outcome === 'blocked') {
      return NextResponse.json(result, { status: 422 });
    }
    if (result.outcome === 'failed') {
      return NextResponse.json(result, { status: 502 });
    }
    if (result.outcome === 'unknown') {
      return NextResponse.json(result, { status: 202 });
    }
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof CogsPeriodRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isXeroPostingDisabledError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[xero/cogs/post]', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Unable to post COGS journal.' }, { status: 500 });
  }
}