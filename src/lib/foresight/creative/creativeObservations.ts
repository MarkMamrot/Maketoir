export type CreativeSource = 'google_ads' | 'meta_ads';

export interface CreativeIdentityObservation {
  source: CreativeSource;
  accountId: string;
  externalId: string;
  creativeKind: 'ad' | 'asset' | 'creative';
  name: string;
  format: string | null;
  status: string | null;
  copy: Record<string, unknown> | null;
  media: Record<string, unknown> | null;
  firstSeenOn: string;
  lastSeenOn: string;
  links: Array<{ entityType: 'campaign' | 'adset' | 'adgroup' | 'ad'; entityId: string; entityName: string | null }>;
  metrics: Array<{
    metricDate: string;
    impressions: number;
    spend: number;
    clicks: number;
    conversions: number;
    attributedRevenue: number;
    reach: number | null;
    frequency: number | null;
    videoViews: number | null;
    currencyCode: string | null;
  }>;
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function date(value: unknown, fallback: string): string {
  const result = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : fallback;
}

function googleAssetText(value: unknown): string {
  const item = record(value);
  return text(item.text ?? item.asset_text ?? value);
}

function mergeCreativeObservations(observations: CreativeIdentityObservation[]): CreativeIdentityObservation[] {
  const merged = new Map<string, CreativeIdentityObservation>();
  for (const observation of observations) {
    const key = `${observation.source}|${observation.accountId}|${observation.externalId}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, structuredClone(observation));
      continue;
    }
    current.firstSeenOn = current.firstSeenOn < observation.firstSeenOn ? current.firstSeenOn : observation.firstSeenOn;
    current.lastSeenOn = current.lastSeenOn > observation.lastSeenOn ? current.lastSeenOn : observation.lastSeenOn;
    const linkKeys = new Set(current.links.map((link) => `${link.entityType}|${link.entityId}`));
    for (const link of observation.links) {
      if (!linkKeys.has(`${link.entityType}|${link.entityId}`)) current.links.push(link);
    }
    for (const metric of observation.metrics) {
      const existing = current.metrics.find((item) => item.metricDate === metric.metricDate);
      if (!existing) {
        current.metrics.push(structuredClone(metric));
        continue;
      }
      existing.impressions += metric.impressions;
      existing.spend += metric.spend;
      existing.clicks += metric.clicks;
      existing.conversions += metric.conversions;
      existing.attributedRevenue += metric.attributedRevenue;
      existing.videoViews = existing.videoViews == null && metric.videoViews == null
        ? null : (existing.videoViews ?? 0) + (metric.videoViews ?? 0);
      existing.reach = null;
      existing.frequency = null;
    }
  }
  return [...merged.values()];
}

export function normalizeGoogleCreativeObservations(input: {
  accountId: string;
  rows: unknown[];
  assetRows?: unknown[];
  windowStart: string;
  windowEnd: string;
}): CreativeIdentityObservation[] {
  const observations: CreativeIdentityObservation[] = [];
  for (const value of input.rows) {
    const row = record(value); const campaign = record(row.campaign); const adGroup = record(row.ad_group);
    const adGroupAd = record(row.ad_group_ad); const ad = record(adGroupAd.ad); const metrics = record(row.metrics);
    const externalId = text(ad.id); if (!externalId) continue;
    const metricDate = date(record(row.segments).date, input.windowEnd);
    const headlines = Array.isArray(record(ad.responsive_search_ad).headlines)
      ? (record(ad.responsive_search_ad).headlines as unknown[]).map(googleAssetText).filter(Boolean) : [];
    const descriptions = Array.isArray(record(ad.responsive_search_ad).descriptions)
      ? (record(ad.responsive_search_ad).descriptions as unknown[]).map(googleAssetText).filter(Boolean) : [];
    observations.push({
      source: 'google_ads', accountId: input.accountId, externalId, creativeKind: 'ad',
      name: text(ad.name) || `Google ad ${externalId}`, format: text(ad.type) || null,
      status: text(adGroupAd.status) || null,
      copy: headlines.length || descriptions.length ? { headlines, descriptions } : null,
      media: Array.isArray(ad.final_urls) ? { finalUrls: ad.final_urls.map(text).filter(Boolean) } : null,
      firstSeenOn: metricDate, lastSeenOn: metricDate,
      links: [
        { entityType: 'campaign', entityId: text(campaign.id), entityName: text(campaign.name) || null },
        { entityType: 'adgroup', entityId: text(adGroup.id), entityName: text(adGroup.name) || null },
      ].filter((link) => link.entityId) as CreativeIdentityObservation['links'],
      metrics: [{ metricDate, impressions: number(metrics.impressions), spend: number(metrics.cost_micros) / 1_000_000,
        clicks: number(metrics.clicks), conversions: number(metrics.conversions), attributedRevenue: number(metrics.conversions_value),
        reach: null, frequency: null, videoViews: number(metrics.video_views) || null,
        currencyCode: text(record(row.customer).currency_code) || null }],
    });
  }
  for (const value of input.assetRows ?? []) {
    const row = record(value); const asset = record(row.asset); const metrics = record(row.metrics);
    const externalId = text(asset.id); if (!externalId) continue;
    const campaign = record(row.campaign); const adGroup = record(row.ad_group); const ad = record(record(row.ad_group_ad).ad);
    const metricDate = date(record(row.segments).date, input.windowEnd);
    observations.push({
      source: 'google_ads', accountId: input.accountId, externalId, creativeKind: 'asset',
      name: text(asset.name) || googleAssetText(asset.text_asset) || `Google asset ${externalId}`,
      format: text(asset.type) || text(record(row.ad_group_ad_asset_view).field_type) || null,
      status: text(record(row.ad_group_ad_asset_view).performance_label) || null,
      copy: googleAssetText(asset.text_asset) ? { text: googleAssetText(asset.text_asset) } : null,
      media: null, firstSeenOn: metricDate, lastSeenOn: metricDate,
      links: [
        { entityType: 'campaign', entityId: text(campaign.id), entityName: text(campaign.name) || null },
        { entityType: 'adgroup', entityId: text(adGroup.id), entityName: text(adGroup.name) || null },
        { entityType: 'ad', entityId: text(ad.id), entityName: null },
      ].filter((link) => link.entityId) as CreativeIdentityObservation['links'],
      metrics: [{ metricDate, impressions: number(metrics.impressions), spend: 0, clicks: number(metrics.clicks), conversions: 0,
        attributedRevenue: 0, reach: null, frequency: null, videoViews: null, currencyCode: text(record(row.customer).currency_code) || null }],
    });
  }
  return mergeCreativeObservations(observations);
}

const PURCHASE_ACTIONS = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase'];
function metaAction(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  const actions = value.map(record);
  for (const type of PURCHASE_ACTIONS) {
    const match = actions.find((item) => item.action_type === type);
    if (match) return number(match.value);
  }
  return 0;
}

function metaActionTotal(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  return value.map(record).reduce((total, item) => total + number(item.value), 0);
}

export function normalizeMetaCreativeObservations(input: {
  accountId: string; rows: unknown[]; windowStart: string; windowEnd: string;
}): CreativeIdentityObservation[] {
  const observations = input.rows.map(record).map((row) => {
    const adId = text(row.ad_id); const creativeId = text(row.creative_id) || adId;
    if (!creativeId) return null;
    const metricDate = date(row.date_start, input.windowEnd);
    return {
      source: 'meta_ads' as const, accountId: input.accountId, externalId: creativeId,
      creativeKind: text(row.creative_id) ? 'creative' as const : 'ad' as const,
      name: text(row.ad_name) || `Meta creative ${creativeId}`, format: text(row.creative_format) || null,
      status: text(row.effective_status) || null,
      copy: text(row.body) || text(row.title) ? { body: text(row.body) || null, title: text(row.title) || null } : null,
      media: text(row.image_hash) || text(row.video_id) || text(row.object_story_id)
        ? { imageHash: text(row.image_hash) || null, videoId: text(row.video_id) || null, objectStoryId: text(row.object_story_id) || null } : null,
      firstSeenOn: metricDate, lastSeenOn: metricDate,
      links: [
        { entityType: 'campaign' as const, entityId: text(row.campaign_id), entityName: text(row.campaign_name) || null },
        { entityType: 'adset' as const, entityId: text(row.adset_id), entityName: text(row.adset_name) || null },
        { entityType: 'ad' as const, entityId: adId, entityName: text(row.ad_name) || null },
      ].filter((link) => link.entityId),
      metrics: [{ metricDate, impressions: number(row.impressions), spend: number(row.spend), clicks: number(row.clicks),
        conversions: metaAction(row.actions), attributedRevenue: metaAction(row.action_values), reach: row.reach == null ? null : number(row.reach),
        frequency: row.frequency == null ? null : number(row.frequency),
        videoViews: metaActionTotal(row.video_thruplay_watched_actions),
        currencyCode: text(row.account_currency) || null }],
    };
  }).filter((value): value is CreativeIdentityObservation => value != null);
  return mergeCreativeObservations(observations);
}
