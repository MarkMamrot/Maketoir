import { describe, expect, it } from 'vitest';
import { reconcileDailyCommerce, type DailyCommerceObservation } from '../metrics/commerceReconciliation';
import type { DailyPaidMediaEntityObservation, DailyPaidMediaObservation } from '../metrics/marketingObservations';
import { buildWeeklyDigest } from '../weeklyDigest';

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function fixtures(options: { missingCurrentDay?: boolean; missingCost?: boolean } = {}) {
  const commerce: DailyCommerceObservation[] = [];
  const paidMedia: DailyPaidMediaObservation[] = [];
  const entities: DailyPaidMediaEntityObservation[] = [];
  for (let offset = -13; offset <= 0; offset += 1) {
    const date = addDays('2026-07-28', offset);
    const current = offset >= -6;
    if (!(options.missingCurrentDay && offset === 0)) {
      commerce.push({
        metricDate: date, channel: 'online', salesIncTax: current ? 220 : 330, salesTax: current ? 20 : 30,
        returnsIncTax: 0, returnsTax: 0, salesCogs: current ? 80 : 120, returnedCogs: 0,
        orderCount: 2, returnCount: 0, costLineCount: 2,
        missingCostLineCount: options.missingCost && offset === 0 ? 1 : 0, costBasis: 'captured',
      });
      commerce.push({
        metricDate: date, channel: 'pos', salesIncTax: 110, salesTax: 10,
        returnsIncTax: 0, returnsTax: 0, salesCogs: 40, returnedCogs: 0,
        orderCount: 1, returnCount: 0, costLineCount: 1, missingCostLineCount: 0, costBasis: 'captured',
      });
    }
    paidMedia.push({ metricDate: date, source: 'google_ads', accountId: 'google', spend: 50, impressions: 100, clicks: 10, conversions: 1, attributedRevenue: current ? 40 : 100, currencyCode: 'AUD' });
    paidMedia.push({ metricDate: date, source: 'meta_ads', accountId: 'meta', spend: 50, impressions: 100, clicks: 10, conversions: 1, attributedRevenue: current ? 30 : 100, currencyCode: 'AUD' });
    entities.push({
      ...paidMedia.at(-1)!, entityType: 'campaign', entityId: 'meta-campaign', entityName: 'Prospecting',
      parentEntityId: null, parentEntityName: null,
    });
  }
  return { commerce, paidMedia, entities, reconciliation: reconcileDailyCommerce(commerce, paidMedia) };
}

function recommendation(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1, state: 'approved', channel: 'paid_media', rule_id: 'mer_deterioration',
    created_at: '2026-07-24T00:00:00.000Z',
    evidence_json: { windowEnd: '2026-07-23', quality: { grade: 'good', issues: [] } },
    ...overrides,
  };
}

describe('weekly Foresight digest', () => {
  it('compares exact seven-day financial windows and keeps POS and attribution diagnostic only', () => {
    const data = fixtures();
    const result = buildWeeklyDigest({
      digestDate: '2026-07-28', reconciliation: data.reconciliation, paidMedia: data.paidMedia,
      paidMediaEntities: data.entities, recommendations: [], events: [], implementations: [], outcomes: [],
    });

    expect(result.current).toMatchObject({
      windowStart: '2026-07-22', windowEnd: '2026-07-28', observedDays: 7, complete: true,
      googleAdsSpend: 350, metaAdsSpend: 350, paidMediaSpend: 700,
      onlineRevenueExTax: 1400, posRevenueExTax: 700, mer: 2,
      platformAttributedRevenue: { googleAds: 280, metaAds: 210 },
    });
    expect(result.previous).toMatchObject({ onlineRevenueExTax: 2100, posRevenueExTax: 700, mer: 3 });
    expect(result.changes.merPercent).toBeCloseTo(-33.33, 1);
    expect(result.notices).toContainEqual(expect.objectContaining({ code: 'mer_declined' }));
  });

  it('marks missing authoritative days and incomplete COGS without inventing POAS', () => {
    const missingDay = fixtures({ missingCurrentDay: true });
    const incompleteCost = fixtures({ missingCost: true });
    const base = { digestDate: '2026-07-28', recommendations: [], events: [], implementations: [], outcomes: [] };
    const first = buildWeeklyDigest({ ...base, reconciliation: missingDay.reconciliation, paidMedia: missingDay.paidMedia, paidMediaEntities: missingDay.entities });
    const second = buildWeeklyDigest({ ...base, reconciliation: incompleteCost.reconciliation, paidMedia: incompleteCost.paidMedia, paidMediaEntities: incompleteCost.entities });
    expect(first.current).toMatchObject({ complete: false, observedDays: 7 });
    expect(first.current.qualityIssues).toContainEqual(expect.objectContaining({ code: 'missing_online_sales_observation' }));
    expect(second.current.complete).toBe(false);
    expect(second.current.contributionPoas).toBeNull();
  });

  it('summarizes workflow activity, outcomes, Klaviyo coverage, and diagnostic contributors', () => {
    const data = fixtures();
    const recommendations = [
      recommendation(),
      recommendation({
        id: 2, channel: 'klaviyo', created_at: '2026-07-26T00:00:00.000Z',
        evidence_json: {
          windowEnd: '2026-07-26', quality: { grade: 'good', issues: [] },
          observedValues: { activeCriticalFlowCount: 4, missingCriticalFlowCount: 1, inactiveCriticalFlowCount: 1 },
          lifecycleFlowCoverage: [{ category: 'welcome', label: 'Welcome', state: 'active', matchedFlows: [] }],
        },
      }),
      recommendation({
        id: 3, channel: 'klaviyo', created_at: '2026-07-10T00:00:00.000Z',
        evidence_json: {
          windowEnd: '2026-07-10', quality: { grade: 'good', issues: [] },
          observedValues: { activeCriticalFlowCount: 3, missingCriticalFlowCount: 2, inactiveCriticalFlowCount: 1 },
          lifecycleFlowCoverage: [],
        },
      }),
    ];
    const result = buildWeeklyDigest({
      digestDate: '2026-07-28', reconciliation: data.reconciliation, paidMedia: data.paidMedia,
      paidMediaEntities: data.entities, recommendations,
      events: [{ to_state: 'approved', created_at: '2026-07-23T00:00:00.000Z' } as any],
      implementations: [{ implemented_on: '2026-07-25' } as any],
      outcomes: [{ direction: 'worsened', created_at: '2026-07-27T00:00:00.000Z' } as any],
    });
    expect(result.operations).toMatchObject({ recommendationsCreated: 2, approvals: 1, implementations: 1, outcomes: { total: 1, worsened: 1 } });
    expect(result.klaviyo.current.activeCriticalFlows).toBe(4);
    expect(result.klaviyo.previous.activeCriticalFlows).toBe(3);
    expect(result.contributors[0]).toMatchObject({ entityName: 'Prospecting', currentPlatformRoas: 0.6, previousPlatformRoas: 2 });
    expect(result.notices).toContainEqual(expect.objectContaining({ code: 'worsened_outcomes' }));
  });
});