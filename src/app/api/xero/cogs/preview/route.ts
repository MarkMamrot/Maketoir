import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { calculateCogsForPeriod } from '@/lib/xero/cogsCalculator';
import { CogsFrequency, getLastCompletedCogsPeriod } from '@/lib/xero/cogsPeriods';

const FREQUENCIES = new Set<CogsFrequency>(['daily', 'weekly', 'monthly', 'quarterly']);

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  try {
    const body = await req.json();
    const databaseId = String(body.databaseId ?? '');
    const frequency = String(body.frequency ?? 'monthly') as CogsFrequency;
    const timeZone = String(body.timeZone ?? process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney');

    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;
    if (!FREQUENCIES.has(frequency)) {
      return NextResponse.json({ error: 'Frequency must be daily, weekly, monthly, or quarterly.' }, { status: 400 });
    }

    let period;
    try {
      period = getLastCompletedCogsPeriod(frequency, new Date(), timeZone);
    } catch {
      return NextResponse.json({ error: 'Invalid business timezone.' }, { status: 400 });
    }

    const calculation = await calculateCogsForPeriod({
      businessId: databaseId,
      startDate: period.startDate,
      endDateExclusive: period.endDateExclusive,
    });

    return NextResponse.json({ success: true, period, calculation });
  } catch (error: unknown) {
    console.error('[xero/cogs/preview]', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Unable to calculate COGS preview.' }, { status: 500 });
  }
}