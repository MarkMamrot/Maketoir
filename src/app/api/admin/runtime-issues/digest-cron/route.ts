import { NextResponse } from 'next/server';
import { checkCronJobEnabled } from '@/lib/cron/settings';

import { retryPendingRuntimeIssueAlerts, sendRuntimeIssuesDailyDigest } from '@/lib/runtimeIssueAlerts';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const paused = await checkCronJobEnabled('runtime-issues-digest');
  if (paused) return paused;

  try {
    const alertRetries = await retryPendingRuntimeIssueAlerts();
    const digest = await sendRuntimeIssuesDailyDigest();
    return NextResponse.json({ success: true, alertRetries, digest });
  } catch (error) {
    console.error('[runtime-issues] daily digest failed:', error);
    return NextResponse.json({ error: 'Runtime Issues digest delivery failed.' }, { status: 500 });
  }
}