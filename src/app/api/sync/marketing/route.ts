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
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { MarketingDataRepository } from '@/lib/db/MarketingDataRepository';

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

      try {
        const conn = await ConnectionsRepository.get(databaseId);
        const { startDate, endDate } = getDateRange(90);

        // ── Google Ads ───────────────────────────────────────────────────────
        if (sources.includes('google-ads')) {
          const customerId = conn?.google_ads_customer_id ?? '';
          if (!customerId) {
            emit({ source: 'google-ads', status: 'error', error: 'Google Ads Customer ID not configured in Connections tab.' });
          } else {
            const svc = new GoogleAdsService(customerId);
            for (const tab of GADS_TABS) {
              emit({ tab: tab.key, label: tab.label, source: 'google-ads', status: 'start' });
              try {
                const raw = await tab.fn(svc, startDate, endDate);
                const rows = flattenRows(Array.isArray(raw) ? raw : []);
                await MarketingDataRepository.replaceTab(databaseId, 'google_ads', customerId, tab.key, rows);
                emit({ tab: tab.key, label: tab.label, source: 'google-ads', status: 'done', rows: Math.max(0, rows.length - 1) });
              } catch (e: any) {
                emit({ tab: tab.key, label: tab.label, source: 'google-ads', status: 'error', error: errorMessage(e) });
              }
            }

            // ── Year-on-Year: same 90-day window, 1 year back ─────────────────
            const { startDate: yoyStart, endDate: yoyEnd } = getDateRange(90, 365);
            emit({ tab: 'GAds_YoY', label: 'Year-on-Year', source: 'google-ads', status: 'start' });
            try {
              const yoyRaw = await svc.getCampaigns(yoyStart, yoyEnd);
              const yoyRows = flattenRows(Array.isArray(yoyRaw) ? yoyRaw : []);
              await MarketingDataRepository.replaceTab(databaseId, 'google_ads', customerId, 'GAds_YoY', yoyRows);
              emit({ tab: 'GAds_YoY', label: 'Year-on-Year', source: 'google-ads', status: 'done', rows: Math.max(0, yoyRows.length - 1) });
            } catch (e: any) {
              emit({ tab: 'GAds_YoY', label: 'Year-on-Year', source: 'google-ads', status: 'error', error: errorMessage(e) });
            }
          }
        }

        // ── Meta Ads ──────────────────────────────────────────────────────
        if (sources.includes('meta')) {
          const adAccountId = conn?.meta_ad_account_id ?? '';
          const accessToken = conn?.meta_access_token ? decrypt(conn.meta_access_token) : '';
          if (!adAccountId || !accessToken) {
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
                emit({ tab: tab.key, label: tab.label, source: 'meta', status: 'done', rows: Math.max(0, rows.length - 1) });
              } catch (e: any) {
                emit({ tab: tab.key, label: tab.label, source: 'meta', status: 'error', error: errorMessage(e) });
              }
            }
          }
        }

        // ── Google Analytics ───────────────────────────────────────────────
        if (sources.includes('ga4')) {
          const propertyId = conn?.ga4_property_id ?? '';
          if (!propertyId) {
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
                emit({ tab: tab.key, label: tab.label, source: 'ga4', status: 'done', rows: Math.max(0, rows.length - 1) });
              } catch (e: any) {
                emit({ tab: tab.key, label: tab.label, source: 'ga4', status: 'error', error: errorMessage(e) });
              }
            }
          }
        }

        // ── Klaviyo ───────────────────────────────────────────────────────
        if (sources.includes('klaviyo')) {
          const klaviyoKey = conn?.klaviyo_api_key ? decrypt(conn.klaviyo_api_key) : '';
          if (!klaviyoKey) {
            emit({ source: 'klaviyo', status: 'error', error: 'Klaviyo API key not configured in Connections tab.' });
          } else {
            const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
            const REVISION = '2024-10-15';
            const kh = { Authorization: `Klaviyo-API-Key ${klaviyoKey}`, revision: REVISION };

            const klaviyoTabs: Array<{ key: string; label: string; url: string; extract: (item: any) => any }> = [
              {
                key: 'Klaviyo_Campaigns', label: 'Email Campaigns',
                url: `${KLAVIYO_BASE}/campaigns/?filter=equals(messages.channel,'email')&page[size]=100&sort=-created_at`,
                extract: (item: any) => {
                  const a = item.attributes ?? {};
                  return {
                    id: item.id ?? '',
                    name: a.name ?? '',
                    status: a.status ?? '',
                    archived: String(a.archived ?? false),
                    send_time: a.send_time ?? '',
                    scheduled_at: a.scheduled_at ?? '',
                    created_at: a.created_at ?? '',
                    updated_at: a.updated_at ?? '',
                  };
                },
              },
              {
                key: 'Klaviyo_Flows', label: 'Automation Flows',
                url: `${KLAVIYO_BASE}/flows/?page[size]=100&sort=-created`,
                extract: (item: any) => {
                  const a = item.attributes ?? {};
                  return {
                    id: item.id ?? '',
                    name: a.name ?? '',
                    status: a.status ?? '',
                    archived: String(a.archived ?? false),
                    trigger_type: a.trigger_type ?? '',
                    created: a.created ?? '',
                    updated: a.updated ?? '',
                  };
                },
              },
              {
                key: 'Klaviyo_Lists', label: 'Lists & Segments',
                url: `${KLAVIYO_BASE}/lists/?page[size]=100`,
                extract: (item: any) => {
                  const a = item.attributes ?? {};
                  return { id: item.id ?? '', name: a.name ?? '', created: a.created ?? '', updated: a.updated ?? '' };
                },
              },
            ];

            for (const tab of klaviyoTabs) {
              emit({ tab: tab.key, label: tab.label, source: 'klaviyo', status: 'start' });
              try {
                const res = await fetch(tab.url, { headers: kh });
                if (!res.ok) throw new Error(`Klaviyo ${tab.label}: HTTP ${res.status}`);
                const json = await res.json();
                const items: any[] = json.data ?? [];
                if (items.length > 0) {
                  const extracted = items.map(tab.extract);
                  const headers = Object.keys(extracted[0]);
                  const dataRows: string[][] = [headers, ...extracted.map(r => headers.map(h => String((r as any)[h] ?? '')))];
                  await MarketingDataRepository.replaceTab(databaseId, 'klaviyo', 'klaviyo', tab.key, dataRows);
                } else {
                  await MarketingDataRepository.replaceTab(databaseId, 'klaviyo', 'klaviyo', tab.key, []);
                }
                emit({ tab: tab.key, label: tab.label, source: 'klaviyo', status: 'done', rows: items.length });
              } catch (e: any) {
                emit({ tab: tab.key, label: tab.label, source: 'klaviyo', status: 'error', error: errorMessage(e) });
              }
            }
          }
        }

        emit({ status: 'complete' });
      } catch (e: any) {
        emit({ status: 'error', error: e.message });
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
