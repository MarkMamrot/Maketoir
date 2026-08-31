import { NextResponse } from 'next/server';
import { reconcileAiBilling } from '@/lib/ai/billing/reconciliation';
import { AiBillingRepository } from '@/lib/ai/billing/repository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { refreshGoogleModelCatalog } from '@/lib/ai/billing/modelCatalogSync';

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cyclesAdvanced = await AiBillingRepository.advanceDueCycles();
  const findings = await reconcileAiBilling();
  let modelCatalog: { discovered: number; observed: number } | null = null;
  try {
    const result = await refreshGoogleModelCatalog();
    modelCatalog = { discovered: result.discovered, observed: result.observed };
  } catch (error) {
    await reportRuntimeIssue({ businessId: '__solvantis_platform__', source: 'ai_model_catalog', operation: 'scheduled_discovery', title: 'Scheduled Google model discovery failed', error });
  }
  for (const finding of findings.filter(item => item.corrupt || item.unknownCalls > 0)) {
    await reportRuntimeIssue({ businessId: finding.businessId, source: 'ai-billing', operation: 'reconciliation', severity: finding.corrupt ? 'critical' : 'warning', title: finding.corrupt ? 'AI account totals need reconciliation' : 'AI calls require billing review', error: finding.corrupt ? 'Cached reservation differs from usage calls.' : 'Submitted AI calls remain in unknown state.', context: finding });
  }
  return NextResponse.json({ checkedAt: new Date().toISOString(), cyclesAdvanced, findings: findings.length, modelCatalog });
}