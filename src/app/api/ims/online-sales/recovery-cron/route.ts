import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { checkCronJobEnabled } from '@/lib/cron/settings';
import { runOnlineRecoveryDispatch } from '@/lib/channels/onlineRecoveryWorker';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const provided = Buffer.from(request.headers.get('x-cron-secret') ?? '');
  const expected = Buffer.from(process.env.CRON_SECRET ?? '');
  if (!expected.length || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  try {
    const paused = await checkCronJobEnabled('online-recovery');
    if (paused) return paused;
    const result = await runOnlineRecoveryDispatch();
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 207 : 200 });
  } catch {
    await reportRuntimeIssue({
      source: 'cron', operation: 'online_recovery_dispatch',
      title: 'Scheduled online recovery could not run', error: new Error('Online recovery dispatch failed.'),
    });
    return NextResponse.json({ error: 'Online recovery dispatch failed.' }, { status: 503 });
  }
}
