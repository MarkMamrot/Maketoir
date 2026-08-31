import { google } from 'googleapis';
import type { AiRateMetric } from './types';
import { DEFAULT_BILLING_FAMILY_MAPPINGS, resolveBillingFamily } from './modelCatalog';
import type { BillingFamilyMapping } from './modelCatalog';

type GoogleMoney = { currencyCode?: string; units?: string; nanos?: number };
type GoogleTier = { startAmount?: { value?: string }; listPrice?: GoogleMoney; contractPrice?: GoogleMoney };
type GooglePrice = {
  name?: string;
  currencyCode?: string;
  valueType?: string;
  rate?: { tiers?: GoogleTier[]; unitInfo?: { unit?: string; unitDescription?: string; unitQuantity?: { value?: string } } };
};

export type GoogleRateCandidate = {
  id: string;
  skuId: string;
  skuName: string;
  priceName: string;
  modelId: string;
  metric: AiRateMetric;
  priceAud: string;
  unitScale: number;
  sourceCurrency: 'AUD';
  sourcePriceDecimal: string;
  audFxRate: '1';
};

export type GoogleRatePreview = {
  fetchedAt: string;
  candidates: GoogleRateCandidate[];
  warnings: Array<{ skuId: string; skuName: string; reason: string; reasonCode?: GoogleSkuReconciliationStatus }>;
  observations: GoogleSkuObservation[];
};

export type GoogleSkuReconciliationStatus = 'mapped' | 'unknown_model' | 'unknown_metric' | 'conflicting_rates' | 'incomplete_pricing' | 'unsupported_tier' | 'currency_issue';
export type GoogleSkuObservation = { skuId: string; skuName: string; priceName: string; mappedModelId: string | null; status: GoogleSkuReconciliationStatus; reason: string };

function parseCredentials() {
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') };
  }
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    || (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
      ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8') : '');
  if (!raw) return undefined;
  try { return JSON.parse(raw); }
  catch {
    if (raw.trim().startsWith('{\\"')) {
      try { return JSON.parse(raw.replace(/\\"/g, '"')); }
      catch { /* Fall through to the credential-file fallback. */ }
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return undefined;
    throw new Error('Google service-account credentials are not valid JSON.');
  }
}

async function getHeaders(): Promise<Record<string, string>> {
  const auth = new google.auth.GoogleAuth({
    credentials: parseCredentials(),
    scopes: ['https://www.googleapis.com/auth/cloud-billing.readonly'],
  });
  const headers = await (await auth.getClient()).getRequestHeaders();
  if (typeof (headers as Headers).entries === 'function') {
    return Object.fromEntries((headers as Headers).entries());
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

async function listPages(url: string, property: string, headers: Record<string, string>): Promise<any[]> {
  const rows: any[] = [];
  let pageToken = '';
  do {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${pageToken ? `${separator}pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers, cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(`Google Cloud Billing returned ${response.status}: ${body?.error?.message || 'request failed'}`);
    rows.push(...(body[property] || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return rows;
}

function moneyDecimal(money: GoogleMoney): string {
  const micros = BigInt(money.units || '0') * 1_000_000n + BigInt(Math.round(Number(money.nanos || 0) / 1_000));
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function metricsFromSku(name: string): AiRateMetric[] {
  const value = name.toLowerCase();
  const imageModel = /gemini\s+\d+(?:\.\d+)?\s+(?:flash[ -]?lite|flash|pro)\s+image\b/.test(value);
  if (/cached/.test(value) && /input|token/.test(value)) return ['cached_input_tokens'];
  if (/thinking|thought/.test(value)) return ['thinking_tokens'];
  if (imageModel && /output|completion|response/.test(value) && !/text\s+(?:output|completion|response)/.test(value)) return ['output_image_tokens'];
  if (/output|completion|response/.test(value)) return ['output_tokens', 'thinking_tokens'];
  if (/input|prompt/.test(value)) return ['input_tokens'];
  return [];
}

function longContextMetric(metric: AiRateMetric): AiRateMetric {
  return `${metric}_over_200k` as AiRateMetric;
}

export function buildGoogleRatePreview(skus: any[], prices: GooglePrice[], fetchedAt = new Date().toISOString(), mappings: BillingFamilyMapping[] = DEFAULT_BILLING_FAMILY_MAPPINGS): GoogleRatePreview {
  const priceBySku = new Map(prices.map(price => [price.name?.match(/\/skus\/([^/]+)\//)?.[1], price]));
  const mappedCandidates: GoogleRateCandidate[] = [];
  const warnings: GoogleRatePreview['warnings'] = [];
  const relevantSkus: Array<{ skuId: string; skuName: string; priceName: string; mappedModelId: string | null }> = [];
  for (const sku of skus) {
    const skuName = String(sku.displayName || sku.description || 'Unnamed Gemini SKU');
    const skuId = String(sku.skuId || sku.name?.split('/').pop() || 'unknown');
    const price = priceBySku.get(skuId);
    if (!/gemini|imagen|veo/i.test(skuName)) continue;
    const mapping = resolveBillingFamily(skuName, mappings);
    const modelId = mapping?.modelId || null;
    relevantSkus.push({ skuId, skuName, priceName: String(price?.name || ''), mappedModelId: modelId });
    if (!modelId) {
      warnings.push({ skuId, skuName, reason: 'No active billing-family mapping targets a discovered runtime model.', reasonCode: 'unknown_model' });
      continue;
    }
    const imageModel = /gemini\s+\d+(?:\.\d+)?\s+(?:flash[ -]?lite|flash|pro)\s+image\b/i.test(skuName);
    const excluded = /batch|flex|priority|storage|grounding|search|maps|audio|video|live|embedding|tuning|experimental|\btts\b/i.test(skuName)
      || (/\bimage\b/i.test(skuName) && !imageModel);
    const tiers = price?.rate?.tiers || [];
    const metrics = metricsFromSku(skuName);
    const unitScale = Number(price?.rate?.unitInfo?.unitQuantity?.value || 0);
    const tierStarts = tiers.map(tier => Number(tier?.startAmount?.value || 0));
    const validTiers = tiers.length === 1 || (tiers.length === 2 && tierStarts[0] === 0 && tierStarts[1] === 200_000);
    const currency = (tiers[0]?.contractPrice || tiers[0]?.listPrice)?.currencyCode || price?.currencyCode;
    if (excluded || currency !== 'AUD' || price?.valueType !== 'rate' || !validTiers || tierStarts[0] !== 0 || !metrics.length || !Number.isSafeInteger(unitScale) || unitScale < 1) {
      const reasonCode: GoogleSkuReconciliationStatus = excluded ? 'unsupported_tier' : currency !== 'AUD' ? 'currency_issue' : !metrics.length ? 'unknown_metric' : 'unsupported_tier';
      warnings.push({ skuId, skuName, reason: excluded ? 'Unsupported service tier, storage, tool, or modality pricing.' : currency !== 'AUD' ? 'Google did not return this price in AUD.' : !metrics.length ? 'No supported billing metric could be identified.' : 'Pricing shape cannot be represented safely.', reasonCode });
      continue;
    }
    for (const [tierIndex, tier] of tiers.entries()) {
      const amount = tier?.contractPrice || tier?.listPrice;
      if (!amount || (amount.currencyCode || price?.currencyCode) !== 'AUD') {
        warnings.push({ skuId, skuName, reason: 'Pricing shape cannot be represented safely.', reasonCode: 'unsupported_tier' });
        continue;
      }
      const explicitLongContext = /(?:>|over|more than)\s*200[,.]?000|over\s*200k|\blong\b/i.test(skuName);
      const useLongContext = tierIndex === 1 || explicitLongContext;
      const priceAud = moneyDecimal(amount);
      for (const baseMetric of metrics) {
        const metric = useLongContext && ['input_tokens', 'cached_input_tokens', 'output_tokens', 'thinking_tokens'].includes(baseMetric) ? longContextMetric(baseMetric) : baseMetric;
        mappedCandidates.push({
          id: `${skuId}:${metric}`, skuId, skuName, priceName: String(price?.name || ''), modelId, metric,
          priceAud, unitScale, sourceCurrency: 'AUD', sourcePriceDecimal: priceAud, audFxRate: '1',
        });
      }
    }
  }
  const candidates: GoogleRateCandidate[] = [];
  const groups = Map.groupBy(mappedCandidates, candidate => `${candidate.modelId}:${candidate.metric}`);
  for (const group of groups.values()) {
    if (group.length === 1) { candidates.push(group[0]); continue; }
    const distinctRates = new Set(group.map(candidate => `${candidate.priceAud}:${candidate.unitScale}`));
    if (distinctRates.size === 1) {
      const [candidate, ...duplicates] = group.sort((left, right) => left.skuId.localeCompare(right.skuId));
      candidates.push(candidate);
      warnings.push(...duplicates.map(duplicate => ({ skuId: duplicate.skuId, skuName: duplicate.skuName, reason: `Equivalent to Google SKU ${candidate.skuId}; one provider rate will be used.`, reasonCode: 'mapped' as const })));
      continue;
    }
    warnings.push(...group.map(candidate => ({ skuId: candidate.skuId, skuName: candidate.skuName, reason: `Conflicts with another Google SKU mapped to ${candidate.modelId} ${candidate.metric}; review manually.`, reasonCode: 'conflicting_rates' as const })));
  }
  const warningBySku = new Map(warnings.map(warning => [warning.skuId, warning]));
  const observations = relevantSkus.map(sku => {
    const warning = warningBySku.get(sku.skuId);
    return { ...sku, status: warning?.reasonCode || 'mapped', reason: warning?.reason || 'Mapped to a supported provider-rate candidate.' };
  });
  return { fetchedAt, candidates, warnings, observations };
}

export async function fetchGoogleRatePreview(mappings: BillingFamilyMapping[] = DEFAULT_BILLING_FAMILY_MAPPINGS): Promise<GoogleRatePreview> {
  const billingAccountId = (process.env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID || process.env.GOOGLE_BILLING_ACCOUNT_ID || '').trim().replace(/^billingAccounts\//, '');
  if (!billingAccountId) throw new Error('GOOGLE_CLOUD_BILLING_ACCOUNT_ID is not configured.');
  const headers = await getHeaders();
  const root = `https://cloudbilling.googleapis.com/v1beta/billingAccounts/${encodeURIComponent(billingAccountId)}`;
  const services = await listPages(`${root}/services?pageSize=5000`, 'billingAccountServices', headers);
  const service = services.find(item => String(item.displayName || '').toLowerCase() === 'gemini api');
  if (!service) throw new Error('The Gemini API service is not visible to this Cloud Billing account.');
  const filter = encodeURIComponent(`billing_account_service = "${service.name}"`);
  const [skus, prices] = await Promise.all([
    listPages(`${root}/skus?pageSize=5000&filter=${filter}`, 'billingAccountSkus', headers),
    listPages(`${root}/skus/-/prices?pageSize=5000&currencyCode=AUD`, 'billingAccountPrices', headers),
  ]);
  return buildGoogleRatePreview(skus, prices, new Date().toISOString(), mappings);
}