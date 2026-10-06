import { NextResponse } from 'next/server';
import { reconcileAiBilling } from '@/lib/ai/billing/reconciliation';
import { AiBillingRepository } from '@/lib/ai/billing/repository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = Boolean(secret) && (
    request.headers.get('x-cron-secret') === secret
    || request.headers.get('authorization') === `Bearer ${secret}`
  );
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const cyclesAdvanced = await AiBillingRepository.advanceDueCycles();
    const findings = await reconcileAiBilling();
    for (const finding of findings.filter(item => item.corrupt || item.unknownCalls > 0)) {
      await reportRuntimeIssue({ businessId: finding.businessId, source: 'ai-billing', operation: 'reconciliation', severity: finding.corrupt ? 'critical' : 'warning', title: finding.corrupt ? 'AI account totals need reconciliation' : 'AI calls require billing review', error: finding.corrupt ? 'Cached reservation differs from usage calls.' : 'Submitted AI calls remain in unknown state.', context: finding });
    }
    return NextResponse.json({ checkedAt: new Date().toISOString(), cyclesAdvanced, findings: findings.length });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'ai-billing',
      operation: 'maintenance',
      severity: 'error',
      title: 'AI billing maintenance failed',
      error,
    }).catch(() => null);
    return NextResponse.json({ error: 'AI billing maintenance failed.' }, { status: 500 });
  }
}