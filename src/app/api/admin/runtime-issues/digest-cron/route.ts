import { NextResponse } from 'next/server';

import { retryPendingRuntimeIssueAlerts, sendRuntimeIssuesDailyDigest } from '@/lib/runtimeIssueAlerts';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const alertRetries = await retryPendingRuntimeIssueAlerts();
    const digest = await sendRuntimeIssuesDailyDigest();
    return NextResponse.json({ success: true, alertRetries, digest });
  } catch (error) {
    console.error('[runtime-issues] daily digest failed:', error);
    return NextResponse.json({ error: 'Runtime Issues digest delivery failed.' }, { status: 500 });
  }
}