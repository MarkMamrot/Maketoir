import { describe, expect, it } from 'vitest';
import { buildCogsPostingAuditFindings } from '../cogsPostingFindings';

describe('COGS posting audit adapter', () => {
  it('flags a completed draft period and links both Solvantis and Xero', () => {
    const findings = buildCogsPostingAuditFindings({ rows: [{
      from: '2026-07-01', toExclusive: '2026-08-01', state: 'Draft journals awaiting posting',
      variance: 125, liveVariance: null, draftCount: 1, uncertainCount: 0, failedCount: 1,
      calculation: { blocked: false }, runs: [{ id: 2, href: 'https://go.xero.com/ManualJournals/View.aspx?manualJournalID=draft-1' }],
    }] } as never);
    expect(findings[0]).toMatchObject({
      checkId: 'cogs_postings', severity: 'error', variance: 125, valueAtRisk: 125,
      sourceHref: '#xero/activity/cogs', xeroHref: 'https://go.xero.com/ManualJournals/View.aspx?manualJournalID=draft-1',
    });
  });

  it('does not flag a fully reconciled or legitimate zero-COGS period', () => {
    const findings = buildCogsPostingAuditFindings({ rows: [{
      from: '2026-08-01', toExclusive: '2026-09-01', state: 'Matches recorded posted total',
      variance: 0, liveVariance: null, draftCount: 0, uncertainCount: 0, failedCount: 0,
      calculation: { blocked: false }, runs: [],
    }] } as never);
    expect(findings).toEqual([]);
  });
});