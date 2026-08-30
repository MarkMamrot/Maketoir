import { google } from 'googleapis';
import type { AiRateMetric } from './types';

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
  warnings: Array<{ skuId: string; skuName: string; reason: string }>;
};

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
    if (raw.trim().startsWith('{\\"')) return JSON.parse(raw.replace(/\\"/g, '"'));
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

function modelIdFromSku(name: string): string | null {
  const match = name.match(/gemini\s+(\d+(?:\.\d+)?)\s+(flash[ -]?lite|flash|pro)\b/i);
  return match ? `gemini-${match[1]}-${match[2].toLowerCase().replace(' ', '-').replace('flash-lite', 'flash-lite')}` : null;
}

function metricsFromSku(name: string): AiRateMetric[] {
  const value = name.toLowerCase();
  if (/cached/.test(value) && /input|token/.test(value)) return ['cached_input_tokens'];
  if (/thinking|thought/.test(value)) return ['thinking_tokens'];
  if (/output|completion|response/.test(value)) return ['output_tokens', 'thinking_tokens'];
  if (/input|prompt/.test(value)) return ['input_tokens'];
  return [];
}

export function buildGoogleRatePreview(skus: any[], prices: GooglePrice[], fetchedAt = new Date().toISOString()): GoogleRatePreview {
  const priceBySku = new Map(prices.map(price => [price.name?.match(/\/skus\/([^/]+)\//)?.[1], price]));
  const mappedCandidates: GoogleRateCandidate[] = [];
  const warnings: GoogleRatePreview['warnings'] = [];
  for (const sku of skus) {
    const skuName = String(sku.displayName || sku.description || 'Unnamed Gemini SKU');
    const skuId = String(sku.skuId || sku.name?.split('/').pop() || 'unknown');
    const modelId = modelIdFromSku(skuName);
    if (!modelId) continue;
    const price = priceBySku.get(skuId);
    const excluded = /batch|flex|priority|storage|grounding|search|maps|audio|video|image|live|embedding|tuning|(?:>|over|up to|less than|more than)\s*\d/i.test(skuName);
    const tiers = price?.rate?.tiers || [];
    const metrics = metricsFromSku(skuName);
    const unitScale = Number(price?.rate?.unitInfo?.unitQuantity?.value || 0);
    const tier = tiers[0];
    const amount = tier?.contractPrice || tier?.listPrice;
    const currency = amount?.currencyCode || price?.currencyCode;
    if (excluded || currency !== 'AUD' || price?.valueType !== 'rate' || tiers.length !== 1 || Number(tier?.startAmount?.value || 0) !== 0 || !amount || !metrics.length || !Number.isSafeInteger(unitScale) || unitScale < 1) {
      warnings.push({ skuId, skuName, reason: excluded ? 'Unsupported service tier, threshold, storage, tool, or modality pricing.' : currency !== 'AUD' ? 'Google did not return this price in AUD.' : 'Pricing shape cannot be represented safely.' });
      continue;
    }
    const priceAud = moneyDecimal(amount);
    for (const metric of metrics) mappedCandidates.push({
      id: `${skuId}:${metric}`, skuId, skuName, priceName: String(price?.name || ''), modelId, metric,
      priceAud, unitScale, sourceCurrency: 'AUD', sourcePriceDecimal: priceAud, audFxRate: '1',
    });
  }
  const candidates: GoogleRateCandidate[] = [];
  const groups = Map.groupBy(mappedCandidates, candidate => `${candidate.modelId}:${candidate.metric}`);
  for (const group of groups.values()) {
    if (group.length === 1) { candidates.push(group[0]); continue; }
    const distinctRates = new Set(group.map(candidate => `${candidate.priceAud}:${candidate.unitScale}`));
    if (distinctRates.size === 1) {
      const [candidate, ...duplicates] = group.sort((left, right) => left.skuId.localeCompare(right.skuId));
      candidates.push(candidate);
      warnings.push(...duplicates.map(duplicate => ({ skuId: duplicate.skuId, skuName: duplicate.skuName, reason: `Equivalent to Google SKU ${candidate.skuId}; one provider rate will be used.` })));
      continue;
    }
    warnings.push(...group.map(candidate => ({ skuId: candidate.skuId, skuName: candidate.skuName, reason: `Conflicts with another Google SKU mapped to ${candidate.modelId} ${candidate.metric}; review manually.` })));
  }
  return { fetchedAt, candidates, warnings };
}

export async function fetchGoogleRatePreview(): Promise<GoogleRatePreview> {
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
  return buildGoogleRatePreview(skus, prices);
}