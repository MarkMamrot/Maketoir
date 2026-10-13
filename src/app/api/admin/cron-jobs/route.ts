import { NextResponse } from 'next/server';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { findCronJob } from '@/lib/cron/catalog';
import { listCronJobSettings, setCronJobEnabled } from '@/lib/cron/settings';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ success: true, jobs: await listCronJobSettings() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await reportRuntimeIssue({ source: 'admin', operation: 'list_cron_jobs', title: 'Cron Jobs could not be loaded', error }).catch(() => null);
    return NextResponse.json({ error: 'Cron Jobs could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  const job = findCronJob(body?.jobId);
  if (!job || typeof body?.enabled !== 'boolean' || body?.confirmed !== true) {
    return NextResponse.json({ error: 'A known job, boolean state, and confirmation are required.' }, { status: 400 });
  }
  try {
    await setCronJobEnabled(job.id, body.enabled, auth.user.userId);
    return NextResponse.json({ success: true, jobId: job.id, enabled: body.enabled });
  } catch (error) {
    await reportRuntimeIssue({ source: 'admin', operation: 'set_cron_job', title: 'Cron job switch could not be saved', error, context: { jobId: job.id, enabled: body.enabled, userId: auth.user.userId } }).catch(() => null);
    return NextResponse.json({ error: 'Cron job switch could not be saved.' }, { status: 500 });
  }
}