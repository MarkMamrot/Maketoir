import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { CogsFrequency, getLastCompletedCogsPeriod } from '@/lib/xero/cogsPeriods';
import { assertXeroPostingEnabled, isXeroPostingDisabledError } from '@/lib/xero/postingPolicy';
import { postCogsPeriod } from '@/services/XeroCogsService';

const FREQUENCIES = new Set<CogsFrequency>(['daily', 'weekly', 'monthly', 'quarterly']);

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  try {
    const body = await req.json();
    const databaseId = String(body.databaseId ?? '');
    const frequency = String(body.frequency ?? 'monthly') as CogsFrequency;
    const overrideReason = typeof body.overrideReason === 'string' ? body.overrideReason : undefined;

    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;
    await assertXeroPostingEnabled(databaseId);
    if (!FREQUENCIES.has(frequency)) {
      return NextResponse.json({ error: 'Frequency must be daily, weekly, monthly, or quarterly.' }, { status: 400 });
    }
    const result = await runImsForBusiness(databaseId, async () => {
      const timeZone = await getBusinessTimeZone(databaseId);
      const period = getLastCompletedCogsPeriod(frequency, new Date(), timeZone);
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
    if (isXeroPostingDisabledError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[xero/cogs/post]', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Unable to post COGS journal.' }, { status: 500 });
  }
}