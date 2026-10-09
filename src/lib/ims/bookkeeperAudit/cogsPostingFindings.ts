import { fingerprintAuditEvidence, type AuditFinding } from './domain';

interface CogsPostingLedger {
  rows: Array<{
    from: string; toExclusive: string; state: string; variance: number; liveVariance: number | null;
    draftCount: number; uncertainCount: number; failedCount: number; calculation: { blocked: boolean };
    runs: Array<{ id: number; href: string | null }>;
  }>;
}

export function buildCogsPostingAuditFindings(ledger: CogsPostingLedger): AuditFinding[] {
  return ledger.rows.flatMap(period => {
    const variance = period.liveVariance ?? period.variance;
    const unresolved = variance !== 0 || period.draftCount > 0 || period.uncertainCount > 0
      || period.failedCount > 0 || period.calculation.blocked;
    if (!unresolved) return [];
    const sourceId = `${period.from}:${period.toExclusive}`;
    const xeroHref = period.runs.find(run => run.href)?.href ?? null;
    const evidence = {
      variance, draftCount: period.draftCount, uncertainCount: period.uncertainCount,
      failedCount: period.failedCount, blocked: period.calculation.blocked,
      runIds: period.runs.map(run => run.id),
    };
    return [{
      key: `cogs_posting:${sourceId}`, checkId: 'cogs_postings' as const,
      fingerprint: fingerprintAuditEvidence(evidence), category: 'accounting_xero' as const,
      severity: period.uncertainCount > 0 || period.calculation.blocked ? 'critical' as const : variance !== 0 ? 'error' as const : 'warning' as const,
      coverage: 'checked' as const, title: 'COGS period is not fully posted',
      summary: `${period.from} to ${period.toExclusive} has ${variance.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })} still unreconciled with Xero.`,
      sourceType: 'cogs_period', sourceId, sourceReference: `${period.from} to ${period.toExclusive}`,
      sourceContext: period.state, sourceHref: '#xero/activity/cogs', xeroHref,
      occurredAt: `${period.toExclusive}T00:00:00.000Z`, detectedAt: new Date().toISOString(), dueDate: null,
      expected: 'Fully posted COGS period', actual: period.state, variance, valueAtRisk: Math.abs(variance),
      recommendedAction: 'Open Xero COGS activity, review the current movement evidence, then post, retry, or update the linked unlocked journal.',
    } satisfies AuditFinding];
  });
}