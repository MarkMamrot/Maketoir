/**
 * POST /api/sync/marketing
 *
 * Streams Server-Sent Events (SSE) as each tab syncs.
 * Body: { databaseId: string, sources: ('google-ads' | 'meta' | 'ga4')[] }
 *
 * Each SSE message is JSON: { tab?: string; status: 'start'|'done'|'error'|'complete'; rows?: number; error?: string }
 */
import { cookies } from 'next/headers';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import { GoogleAnalyticsService } from '@/services/GoogleAnalyticsService';
import { KlaviyoService } from '@/services/KlaviyoService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { MarketingDataRepository } from '@/lib/db/MarketingDataRepository';
import {
  ForesightIngestionRepository,
  type ForesightSyncSource,
  type RecordSyncTabInput,
} from '@/lib/foresight/repositories/ForesightIngestionRepository';
import {
  aggregateGoogleAdsDaily,
  aggregateGoogleAdsEntities,
  aggregateMetaAdsDaily,
  aggregateMetaAdsEntities,
} from '@/lib/foresight/metrics/marketingObservations';
import { ImsCommerceRepository } from '@/lib/foresight/repositories/ImsCommerceRepository';
import { ForesightRecommendationService } from '@/lib/foresight/ForesightRecommendationService';

/** Extract a readable message from any error shape (Google Ads API returns e.errors[0].message). */
function errorMessage(e: any): string {
  if (e?.errors?.[0]?.message) return e.errors[0].message;
  if (e?.message) return e.message;
  try { return JSON.stringify(e); } catch { return 'Unknown error'; }
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function getDateRange(daysBack = 90, offsetDays = 0) {
  const anchor = new Date();
  anchor.setDate(anchor.getDate() - offsetDays);
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - daysBack);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { startDate: fmt(start), endDate: fmt(anchor) };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// ── Row flattener — turn an array of Google Ads API objects into 2D array ─────
function flattenRows(rows: any[]): string[][] {
  if (!rows || rows.length === 0) return [];
  // Recursively flatten nested objects with dot-notation keys
  const flatten = (obj: any, prefix = ''): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj ?? {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(out, flatten(v, key));
      } else if (Array.isArray(v)) {
        out[key] = v.map((item: any) => (typeof item === 'object' ? JSON.stringify(item) : String(item ?? ''))).join(' | ');
      } else {
        out[key] = v ?? '';
      }
    }
    return out;
  };

  const flatRows = rows.map(r => flatten(r));
  const headers = Array.from(new Set(flatRows.flatMap(r => Object.keys(r))));
  const data: string[][] = [headers];
  for (const r of flatRows) {
    data.push(headers.map(h => String(r[h] ?? '')));
  }
  return data;
}

// ── Google Ads tabs config ────────────────────────────────────────────────────
type GAdsTabKey =
  | 'GAds_Campaigns' | 'GAds_AdGroups' | 'GAds_Keywords' | 'GAds_SearchTerms'
  | 'GAds_Ads' | 'GAds_Assets' | 'GAds_Shopping' | 'GAds_WeeklyTrend'
  | 'GAds_Daypart' | 'GAds_ByDevice' | 'GAds_ByGeo' | 'GAds_Audiences'
  | 'GAds_ConvActions' | 'GAds_Competitors' | 'GAds_LandingPages'
  | 'GAds_YearlyTrend' | 'GAds_YoY';

interface GAdsTab {
  key: GAdsTabKey;
  label: string;
  fn: (svc: GoogleAdsService, s: string, e: string) => Promise<any>;
}

const GADS_TABS: GAdsTab[] = [
  { key: 'GAds_Campaigns',    label: 'Campaigns',         fn: (s, a, b) => s.getCampaigns(a, b) },
  { key: 'GAds_AdGroups',     label: 'Ad Groups',         fn: (s, a, b) => s.getAdGroups(a, b) },
  { key: 'GAds_Keywords',     label: 'Keywords',          fn: (s, a, b) => s.getKeywords(a, b) },
  { key: 'GAds_SearchTerms',  label: 'Search Terms',      fn: (s, a, b) => s.getSearchTerms(a, b) },
  { key: 'GAds_Ads',          label: 'Ads',               fn: (s, a, b) => s.getAds(a, b) },
  { key: 'GAds_Assets',       label: 'RSA Assets',        fn: (s, a, b) => s.getAssetPerformance(a, b) },
  { key: 'GAds_Shopping',     label: 'Shopping',          fn: (s, a, b) => s.getShopping(a, b) },
  { key: 'GAds_WeeklyTrend',  label: 'Weekly Trend',      fn: (s, a, b) => s.getWeeklyTrend(a, b) },
  { key: 'GAds_Daypart',      label: 'Dayparting',        fn: (s, a, b) => s.getDaypart(a, b) },
  { key: 'GAds_ByDevice',     label: 'By Device',         fn: (s, a, b) => s.getByDevice(a, b) },
  { key: 'GAds_ByGeo',        label: 'By Geography',      fn: (s, a, b) => s.getByGeo(a, b) },
  { key: 'GAds_Audiences',    label: 'Audiences',         fn: (s, a, b) => s.getAudiences(a, b) },
  { key: 'GAds_ConvActions',  label: 'Conversion Actions',fn: (s, a, b) => s.getConversionActions(a, b) },
  { key: 'GAds_Competitors',  label: 'Competitors',       fn: (s, a, b) => s.getAuctionInsights(a, b) },
  { key: 'GAds_LandingPages', label: 'Landing Pages',     fn: (s, a, b) => s.getLandingPages(a, b) },
  { key: 'GAds_YearlyTrend',  label: 'Yearly Trend',      fn: (s, a, b) => s.getYearlyTrend(a, b) },
];

// ── Meta helpers ──────────────────────────────────────────────────────────────
async function fetchMetaInsights(
  accountId: string,
  accessToken: string,
  level: 'campaign' | 'adset' | 'ad',
  fields: string[],
  datePreset = 'last_90d',
  breakdowns?: string[],
): Promise<any[]> {
  const id = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const url = new URL(`https://graph.facebook.com/v19.0/${id}/insights`);
  url.searchParams.set('level', level);
  url.searchParams.set('fields', fields.join(','));
  url.searchParams.set('date_preset', datePreset);
  if (breakdowns?.length) url.searchParams.set('breakdowns', breakdowns.join(','));
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);

  const allData: any[] = [];
  let nextUrl: string | null = url.toString();
  while (nextUrl) {
    const res: Response = await fetch(nextUrl);
    const json: any = await res.json();
    if (json.error) throw new Error(json.error.message);
    allData.push(...(json.data ?? []));
    nextUrl = json.paging?.next ?? null;
  }
  return allData;
}

async function fetchMetaDailyInsights(
  accountId: string,
  accessToken: string,
  startDate: string,
  endDate: string,
  level: 'campaign' | 'adset' = 'campaign',
): Promise<any[]> {
  const id = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const url = new URL(`https://graph.facebook.com/v19.0/${id}/insights`);
  url.searchParams.set('level', level);
  url.searchParams.set(
    'fields',
    level === 'campaign'
      ? 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,account_currency,date_start,date_stop'
      : 'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,actions,action_values,account_currency,date_start,date_stop',
  );
  url.searchParams.set('time_range', JSON.stringify({ since: startDate, until: endDate }));
  url.searchParams.set('time_increment', '1');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);

  const allData: any[] = [];
  let nextUrl: string | null = url.toString();
  while (nextUrl) {
    const response: Response = await fetch(nextUrl);
    const json: any = await response.json();
    if (json.error) throw new Error(json.error.message);
    allData.push(...(json.data ?? []));
    nextUrl = json.paging?.next ?? null;
  }
  return allData;
}

function metaToRows(data: any[], fields: string[]): string[][] {
  if (!data.length) return [];
  const headers = [...fields];
  const rows: string[][] = [headers];
  for (const d of data) {
    rows.push(headers.map(f => {
      const v = d[f];
      return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    }));
  }
  return rows;
}

function recordsToRows(records: Array<Record<string, unknown>>): string[][] {
  if (records.length === 0) return [];
  const headers = Object.keys(records[0]);
  return [headers, ...records.map((record) => headers.map((header) => String(record[header] ?? '')))];
}

const SYNC_SOURCE_MAP: Record<string, ForesightSyncSource> = {
  'google-ads': 'google_ads',
  meta: 'meta_ads',
  ga4: 'ga4',
  klaviyo: 'klaviyo',
};

// ── GA4 helpers ───────────────────────────────────────────────────────────────
async function fetchGA4Report(
  ga: GoogleAnalyticsService,
  dimensions: string[],
  metrics: string[],
  startDate: string,
  endDate: string,
): Promise<string[][]> {
  return ga.runReport(dimensions, metrics, startDate, endDate);
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401 });
  }

  const { databaseId, sources } = await req.json() as { databaseId: string; sources: string[] };
  if (!databaseId || !sources?.length) {
    return new Response(JSON.stringify({ error: 'databaseId and sources are required.' }), { status: 400 });
  }
  const _u = JSON.parse(session.value);
  if (databaseId !== _u.businessId) {
    return new Response(JSON.stringify({ error: 'Not authorised.' }), { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let runId: number | null = null;
      let successfulTabs = 0;
      let failedTabs = 0;
      const recordTab = async (input: RecordSyncTabInput) => {
        if (runId == null) throw new Error('Foresight sync run has not started.');
        await ForesightIngestionRepository.recordSyncTab(runId, databaseId, input);
        if (input.state === 'succeeded') successfulTabs += 1;
        else failedTabs += 1;
      };

      try {
        const conn = await ConnectionsRepository.get(databaseId);
        const { startDate, endDate } = getDateRange(90);
        const requestedSources = [...new Set(
          sources.map((source) => SYNC_SOURCE_MAP[source]).filter(Boolean),
        )];
        runId = await ForesightIngestionRepository.startSyncRun(
          databaseId,
          requestedSources,
          startDate,
          endDate,
          Number(_u.userId) || null,
        );

        // ── Google Ads ───────────────────────────────────────────────────────
        if (sources.includes('google-ads')) {
          const customerId = conn?.google_ads_customer_id ?? '';
          if (!customerId) {
            await recordTab({
              source: 'google_ads', accountId: '', tabKey: 'configuration', label: 'Configuration',
              state: 'failed', windowStart: startDate, windowEnd: endDate,
              error: 'Google Ads Customer ID not configured in Connections tab.',
            });
            emit({ source: 'google-ads', status: 'error', error: 'Google Ads Customer ID not configured in Connections tab.' });
          } else {
            const svc = new GoogleAdsService(customerId);
            for (const tab of GADS_TABS) {
              emit({ tab: tab.key, label: tab.label, source: 'google-ads', status: 'start' });
              try {
                const raw = await tab.fn(svc, startDate, endDate);
                const rows = flattenRows(Array.isArray(raw) ? raw : []);
                await MarketingDataRepository.replaceTab(databaseId, 'google_ads', customerId, tab.key, rows);
                await recordTab({
                  source: 'google_ads', accountId: customerId, tabKey: tab.key, label: tab.label,
                  state: 'succeeded', windowStart: startDate, windowEnd: endDate,
                  rowCount: Math.max(0, rows.length - 1),
                });
                emit({ tab: tab.key, label: tab.label, source: 'google-ads', status: 'done', rows: Math.max(0, rows.length - 1) });
              } catch (e: any) {
                const message = errorMessage(e);
                await recordTab({
                  source: 'google_ads', accountId: customerId, tabKey: tab.key, label: tab.label,
                  state: 'failed', windowStart: startDate, windowEnd: endDate, error: message,
                });
                emit({ tab: tab.key, label: tab.label, source: 'google-ads', status: 'error', error: message });
              }
            }

            // ── Year-on-Year: same 90-day window, 1 year back ─────────────────
            const { startDate: yoyStart, endDate: yoyEnd } = getDateRange(90, 365);
            emit({ tab: 'GAds_YoY', label: 'Year-on-Year', source: 'google-ads', status: 'start' });
            try {
              const yoyRaw = await svc.getCampaigns(yoyStart, yoyEnd);
              const yoyRows = flattenRows(Array.isArray(yoyRaw) ? yoyRaw : []);
              await MarketingDataRepository.replaceTab(databaseId, 'google_ads', customerId, 'GAds_YoY', yoyRows);
              await recordTab({
                source: 'google_ads', accountId: customerId, tabKey: 'GAds_YoY', label: 'Year-on-Year',
                state: 'succeeded', windowStart: yoyStart, windowEnd: yoyEnd,
                rowCount: Math.max(0, yoyRows.length - 1),
              });
              emit({ tab: 'GAds_YoY', label: 'Year-on-Year', source: 'google-ads', status: 'done', rows: Math.max(0, yoyRows.length - 1) });
            } catch (e: any) {
              const message = errorMessage(e);
              await recordTab({
                source: 'google_ads', accountId: customerId, tabKey: 'GAds_YoY', label: 'Year-on-Year',
                state: 'failed', windowStart: yoyStart, windowEnd: yoyEnd, error: message,
              });
              emit({ tab: 'GAds_YoY', label: 'Year-on-Year', source: 'google-ads', status: 'error', error: message });
            }

            emit({ tab: 'GAds_DailyPerformance', label: 'Daily Performance', source: 'google-ads', status: 'start' });
            try {
              const dailyRows = await svc.getDailyPerformance(startDate, endDate);
              const observations = aggregateGoogleAdsDaily(
                Array.isArray(dailyRows) ? dailyRows : [],
                customerId,
              );
              const entityObservations = aggregateGoogleAdsEntities(
                Array.isArray(dailyRows) ? dailyRows : [],
                customerId,
              );
              await ForesightIngestionRepository.appendPaidMediaObservations(runId, databaseId, observations);
              await ForesightIngestionRepository.appendPaidMediaEntityObservations(
                runId,
                databaseId,
                entityObservations,
              );
              await recordTab({
                source: 'google_ads', accountId: customerId,
                tabKey: 'GAds_DailyPerformance', label: 'Daily Performance',
                state: 'succeeded', windowStart: startDate, windowEnd: endDate,
                rowCount: observations.length,
                metadata: { grain: 'account_day', entityGrain: 'campaign_day', entityRows: entityObservations.length },
              });
              emit({
                tab: 'GAds_DailyPerformance', label: 'Daily Performance', source: 'google-ads',
                status: 'done', rows: observations.length,
              });
            } catch (e: any) {
              const message = errorMessage(e);
              await recordTab({
                source: 'google_ads', accountId: customerId,
                tabKey: 'GAds_DailyPerformance', label: 'Daily Performance',
                state: 'failed', windowStart: startDate, windowEnd: endDate, error: message,
              });
              emit({
                tab: 'GAds_DailyPerformance', label: 'Daily Performance', source: 'google-ads',
                status: 'error', error: message,
              });
            }
          }
        }

        // ── Meta Ads ──────────────────────────────────────────────────────
        if (sources.includes('meta')) {
          const adAccountId = conn?.meta_ad_account_id ?? '';
          const accessToken = conn?.meta_access_token ? decrypt(conn.meta_access_token) : '';
          if (!adAccountId || !accessToken) {
            await recordTab({
              source: 'meta_ads', accountId: adAccountId, tabKey: 'configuration', label: 'Configuration',
              state: 'failed', windowStart: startDate, windowEnd: endDate,
              error: 'Meta credentials not configured in Connections tab.',
            });
            emit({ source: 'meta', status: 'error', error: 'Meta credentials not configured in Connections tab.' });
          } else {
            // Only use fields that are valid in the Meta Insights API.
            // Management fields (status, optimization_goal, bid_strategy, daily_budget,
            // lifetime_budget) and raw video action arrays are excluded to avoid API errors.
            const META_TABS = [
              {
                key: 'Meta_Campaigns', label: 'Campaigns', level: 'campaign' as const,
                fields: ['campaign_id','campaign_name','objective','spend','impressions','clicks','ctr','cpm','cpc','cpp','reach','frequency','actions','purchase_roas','cost_per_result','date_start','date_stop'],
              },
              {
                key: 'Meta_AdSets', label: 'Ad Sets', level: 'adset' as const,
                fields: ['campaign_id','campaign_name','adset_id','adset_name','spend','impressions','clicks','ctr','cpm','cpc','reach','frequency','actions','cost_per_result','date_start','date_stop'],
              },
              {
                key: 'Meta_Ads', label: 'Ads', level: 'ad' as const,
                fields: ['campaign_name','adset_name','ad_id','ad_name','spend','impressions','clicks','ctr','cpm','cpc','reach','frequency','actions','purchase_roas','cost_per_result','date_start','date_stop'],
              },
              {
                // Breakdown by placement (Feed, Reels, Stories, etc.) to identify creative fatigue & channel fit
                key: 'Meta_Placements', label: 'Placements', level: 'campaign' as const,
                fields: ['campaign_name','spend','impressions','clicks','ctr','cpm','cpc','reach','frequency','actions','purchase_roas','date_start','date_stop'],
                breakdowns: ['publisher_platform','platform_position','impression_device'],
              },
              {
                // Breakdown by age/gender to guide creative targeting decisions
                key: 'Meta_Demographics', label: 'Demographics', level: 'campaign' as const,
                fields: ['campaign_name','spend','impressions','clicks','ctr','cpm','reach','frequency','actions','purchase_roas','date_start','date_stop'],
                breakdowns: ['age','gender'],
              },
            ];
            for (const tab of META_TABS) {
              emit({ tab: tab.key, label: tab.label, source: 'meta', status: 'start' });
              try {
                const data = await fetchMetaInsights(adAccountId, accessToken, tab.level, tab.fields, 'last_90d', (tab as any).breakdowns);
                const tabBreakdowns: string[] = (tab as any).breakdowns ?? [];
                const rows = metaToRows(data, [...tabBreakdowns, ...tab.fields]);
                await MarketingDataRepository.replaceTab(databaseId, 'meta', adAccountId, tab.key, rows);
                await recordTab({
                  source: 'meta_ads', accountId: adAccountId, tabKey: tab.key, label: tab.label,
                  state: 'succeeded', windowStart: startDate, windowEnd: endDate,
                  rowCount: Math.max(0, rows.length - 1),
                });
                emit({ tab: tab.key, label: tab.label, source: 'meta', status: 'done', rows: Math.max(0, rows.length - 1) });
              } catch (e: any) {
                const message = errorMessage(e);
                await recordTab({
                  source: 'meta_ads', accountId: adAccountId, tabKey: tab.key, label: tab.label,
                  state: 'failed', windowStart: startDate, windowEnd: endDate, error: message,
                });
                emit({ tab: tab.key, label: tab.label, source: 'meta', status: 'error', error: message });
              }
            }

            emit({ tab: 'Meta_DailyPerformance', label: 'Daily Performance', source: 'meta', status: 'start' });
            try {
              const dailyRows = await fetchMetaDailyInsights(adAccountId, accessToken, startDate, endDate);
              const currencyCode = String(dailyRows[0]?.account_currency ?? '').trim() || null;
              const observations = aggregateMetaAdsDaily(dailyRows, adAccountId, currencyCode);
              const entityObservations = aggregateMetaAdsEntities(
                dailyRows,
                adAccountId,
                'campaign',
                currencyCode,
              );
              await ForesightIngestionRepository.appendPaidMediaObservations(runId, databaseId, observations);
              await ForesightIngestionRepository.appendPaidMediaEntityObservations(
                runId,
                databaseId,
                entityObservations,
              );
              await recordTab({
                source: 'meta_ads', accountId: adAccountId,
                tabKey: 'Meta_DailyPerformance', label: 'Daily Performance',
                state: 'succeeded', windowStart: startDate, windowEnd: endDate,
                rowCount: observations.length,
                metadata: { grain: 'account_day', entityGrain: 'campaign_day', entityRows: entityObservations.length },
              });
              emit({
                tab: 'Meta_DailyPerformance', label: 'Daily Performance', source: 'meta',
                status: 'done', rows: observations.length,
              });
            } catch (e: any) {
              const message = errorMessage(e);
              await recordTab({
                source: 'meta_ads', accountId: adAccountId,
                tabKey: 'Meta_DailyPerformance', label: 'Daily Performance',
                state: 'failed', windowStart: startDate, windowEnd: endDate, error: message,
              });
              emit({
                tab: 'Meta_DailyPerformance', label: 'Daily Performance', source: 'meta',
                status: 'error', error: message,
              });
            }

            emit({ tab: 'Meta_AdSetDailyPerformance', label: 'Ad Set Daily Performance', source: 'meta', status: 'start' });
            try {
              const dailyRows = await fetchMetaDailyInsights(
                adAccountId,
                accessToken,
                startDate,
                endDate,
                'adset',
              );
              const currencyCode = String(dailyRows[0]?.account_currency ?? '').trim() || null;
              const entityObservations = aggregateMetaAdsEntities(
                dailyRows,
                adAccountId,
                'adset',
                currencyCode,
              );
              await ForesightIngestionRepository.appendPaidMediaEntityObservations(
                runId,
                databaseId,
                entityObservations,
              );
              await recordTab({
                source: 'meta_ads', accountId: adAccountId,
                tabKey: 'Meta_AdSetDailyPerformance', label: 'Ad Set Daily Performance',
                state: 'succeeded', windowStart: startDate, windowEnd: endDate,
                rowCount: entityObservations.length, metadata: { grain: 'adset_day' },
              });
              emit({
                tab: 'Meta_AdSetDailyPerformance', label: 'Ad Set Daily Performance', source: 'meta',
                status: 'done', rows: entityObservations.length,
              });
            } catch (e: any) {
              const message = errorMessage(e);
              await recordTab({
                source: 'meta_ads', accountId: adAccountId,
                tabKey: 'Meta_AdSetDailyPerformance', label: 'Ad Set Daily Performance',
                state: 'failed', windowStart: startDate, windowEnd: endDate, error: message,
              });
              emit({
                tab: 'Meta_AdSetDailyPerformance', label: 'Ad Set Daily Performance', source: 'meta',
                status: 'error', error: message,
              });
            }
          }
        }

        // ── Google Analytics ───────────────────────────────────────────────
        if (sources.includes('ga4')) {
          const propertyId = conn?.ga4_property_id ?? '';
          if (!propertyId) {
            await recordTab({
              source: 'ga4', accountId: '', tabKey: 'configuration', label: 'Configuration',
              state: 'failed', windowStart: startDate, windowEnd: endDate,
              error: 'GA4 Property ID not configured in Connections tab.',
            });
            emit({ source: 'ga4', status: 'error', error: 'GA4 Property ID not configured in Connections tab.' });
          } else {
            const ga = new GoogleAnalyticsService(propertyId);
            const GA4_TABS = [
              {
                // date kept — channel/source trend over time is useful for spotting shifts
                key: 'GA4_Channels', label: 'Channels',
                dims: ['date','sessionDefaultChannelGroup','sessionSource','sessionMedium','sessionCampaignName'],
                mets: ['sessions','activeUsers','newUsers','engagementRate','bounceRate','averageSessionDuration','conversions','totalRevenue'],
              },
              {
                // date dropped — one row per landing page aggregated over the period avoids 26k row bloat
                key: 'GA4_LandingPages', label: 'Landing Pages',
                dims: ['landingPage'],
                mets: ['sessions','activeUsers','engagementRate','bounceRate','conversions','totalRevenue'],
              },
              {
                // date dropped — one row per product aggregated over the period is far more useful
                key: 'GA4_Ecommerce', label: 'E-commerce',
                dims: ['itemName','itemBrand','itemCategory'],
                mets: ['itemRevenue','itemsPurchased','itemsViewed','itemsAddedToCart','purchaseToViewRate'],
              },
              {
                // date dropped — device split as a single snapshot is what informs bid modifiers
                key: 'GA4_Devices', label: 'Devices',
                dims: ['deviceCategory','operatingSystem','browser'],
                mets: ['sessions','activeUsers','engagementRate','conversions','totalRevenue'],
              },
              {
                // date dropped — one row per location, sorted by revenue, is the strategic view
                key: 'GA4_Geography', label: 'Geography',
                dims: ['country','region','city'],
                mets: ['sessions','activeUsers','conversions','totalRevenue'],
              },
              {
                // 12 months of monthly channel data — lets the AI identify seasonal revenue peaks/valleys
                key: 'GA4_YearlyChannels', label: 'Yearly Channels',
                dims: ['yearMonth','sessionDefaultChannelGroup'],
                mets: ['sessions','activeUsers','conversions','totalRevenue'],
                dateOverride: getDateRange(365),
              },
            ];
            for (const tab of GA4_TABS) {
              emit({ tab: tab.key, label: tab.label, source: 'ga4', status: 'start' });
              try {
                const tabStart = (tab as any).dateOverride?.startDate ?? startDate;
                const tabEnd   = (tab as any).dateOverride?.endDate   ?? endDate;
                const rows = await fetchGA4Report(ga, tab.dims, tab.mets, tabStart, tabEnd);
                await MarketingDataRepository.replaceTab(databaseId, 'ga4', propertyId, tab.key, rows);
                await recordTab({
                  source: 'ga4', accountId: propertyId, tabKey: tab.key, label: tab.label,
                  state: 'succeeded', windowStart: tabStart, windowEnd: tabEnd,
                  rowCount: Math.max(0, rows.length - 1),
                });
                emit({ tab: tab.key, label: tab.label, source: 'ga4', status: 'done', rows: Math.max(0, rows.length - 1) });
              } catch (e: any) {
                const message = errorMessage(e);
                await recordTab({
                  source: 'ga4', accountId: propertyId, tabKey: tab.key, label: tab.label,
                  state: 'failed', windowStart: startDate, windowEnd: endDate, error: message,
                });
                emit({ tab: tab.key, label: tab.label, source: 'ga4', status: 'error', error: message });
              }
            }
          }
        }

        // ── Klaviyo ───────────────────────────────────────────────────────
        if (sources.includes('klaviyo')) {
          const klaviyoKey = conn?.klaviyo_api_key ? decrypt(conn.klaviyo_api_key) : '';
          if (!klaviyoKey) {
            await recordTab({
              source: 'klaviyo', accountId: 'klaviyo', tabKey: 'configuration', label: 'Configuration',
              state: 'failed', error: 'Klaviyo API key not configured in Connections tab.',
            });
            emit({ source: 'klaviyo', status: 'error', error: 'Klaviyo API key not configured in Connections tab.' });
          } else {
            const klaviyo = new KlaviyoService(klaviyoKey);
            const klaviyoTabs: Array<{
              key: string;
              label: string;
              load: () => Promise<Array<Record<string, unknown>>>;
            }> = [
              {
                key: 'Klaviyo_Campaigns', label: 'Email Campaigns',
                load: () => klaviyo.getCampaigns(),
              },
              {
                key: 'Klaviyo_Flows', label: 'Automation Flows',
                load: () => klaviyo.getFlows(),
              },
              {
                key: 'Klaviyo_Lists', label: 'Lists & Segments',
                load: () => klaviyo.getLists(),
              },
            ];

            for (const tab of klaviyoTabs) {
              emit({ tab: tab.key, label: tab.label, source: 'klaviyo', status: 'start' });
              try {
                const records = await tab.load();
                await MarketingDataRepository.replaceTab(
                  databaseId,
                  'klaviyo',
                  'klaviyo',
                  tab.key,
                  recordsToRows(records),
                );
                await recordTab({
                  source: 'klaviyo', accountId: 'klaviyo', tabKey: tab.key, label: tab.label,
                  state: 'succeeded', rowCount: records.length,
                  metadata: { revision: klaviyo.revision, snapshot: true },
                });
                emit({
                  tab: tab.key,
                  label: tab.label,
                  source: 'klaviyo',
                  status: 'done',
                  rows: records.length,
                  revision: klaviyo.revision,
                });
              } catch (e: any) {
                const message = errorMessage(e);
                await recordTab({
                  source: 'klaviyo', accountId: 'klaviyo', tabKey: tab.key, label: tab.label,
                  state: 'failed', error: message, metadata: { revision: klaviyo.revision, snapshot: true },
                });
                emit({ tab: tab.key, label: tab.label, source: 'klaviyo', status: 'error', error: message });
              }
            }
          }
        }

        emit({ tab: 'Commerce_Daily', label: 'Retail Commerce', source: 'commerce', status: 'start' });
        try {
          const commerce = await ImsCommerceRepository.getDailyCommerce(databaseId, startDate, endDate);
          await ForesightIngestionRepository.appendCommerceObservations(runId, databaseId, commerce);
          await recordTab({
            source: 'commerce', accountId: 'ims', tabKey: 'Commerce_Daily', label: 'Retail Commerce',
            state: 'succeeded', windowStart: startDate, windowEnd: endDate,
            rowCount: commerce.length,
            metadata: { grain: 'channel_day', revenueAuthority: 'ims' },
          });
          emit({
            tab: 'Commerce_Daily', label: 'Retail Commerce', source: 'commerce',
            status: 'done', rows: commerce.length,
          });
        } catch (e: any) {
          const message = errorMessage(e);
          await recordTab({
            source: 'commerce', accountId: 'ims', tabKey: 'Commerce_Daily', label: 'Retail Commerce',
            state: 'failed', windowStart: startDate, windowEnd: endDate, error: message,
          });
          emit({
            tab: 'Commerce_Daily', label: 'Retail Commerce', source: 'commerce',
            status: 'error', error: message,
          });
        }

        const state = failedTabs === 0 ? 'succeeded' : successfulTabs > 0 ? 'partial' : 'failed';
        await ForesightIngestionRepository.completeSyncRun(
          runId,
          databaseId,
          state,
          successfulTabs,
          failedTabs,
        );
        let recommendationCount: number | null = null;
        if (sources.includes('google-ads') || sources.includes('meta')) {
          try {
            const evaluation = await ForesightRecommendationService.evaluatePaidMedia(
              databaseId,
              addDays(endDate, -1),
            );
            recommendationCount = evaluation.recommendationCount;
            emit({
              source: 'foresight',
              status: 'done',
              recommendations: evaluation.recommendationCount,
              expiredRecommendations: evaluation.expiredCount,
            });
          } catch (evaluationError) {
            emit({
              source: 'foresight',
              status: 'error',
              error: errorMessage(evaluationError),
            });
          }
        }
        emit({ status: 'complete', runId, state, successfulTabs, failedTabs, recommendationCount });
      } catch (e: any) {
        const message = errorMessage(e);
        if (runId != null) {
          try {
            await ForesightIngestionRepository.completeSyncRun(
              runId,
              databaseId,
              'failed',
              successfulTabs,
              failedTabs + 1,
              message,
            );
          } catch (completionError) {
            console.error('Failed to finalize Foresight sync run:', completionError);
          }
        }
        emit({ status: 'error', runId, error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
