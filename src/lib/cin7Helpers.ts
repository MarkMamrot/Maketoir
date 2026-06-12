/**
 * Shared helpers for Cin7-backed sync routes.
 * Reads credentials and config from MySQL instead of Google Sheets.
 */
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { decrypt } from '@/lib/encryption';

export interface Cin7Credentials {
  accountId: string;
  apiKey: string;
  authHeader: string;
}

/**
 * Load and decrypt Cin7 credentials from MySQL connections table.
 * Throws with a user-friendly message if credentials are missing.
 */
export async function getCin7Credentials(businessId: string): Promise<Cin7Credentials> {
  const row = await ConnectionsRepository.get(businessId);
  const accountId = row?.cin7_account_id ?? '';
  const encKey    = row?.cin7_api_key    ?? '';
  const apiKey    = encKey ? decrypt(encKey) : '';

  if (!accountId || !apiKey) {
    throw new Error('Cin7 credentials not configured. Save them in Setup → Connections first.');
  }

  const authHeader = `Basic ${Buffer.from(`${accountId}:${apiKey}`).toString('base64')}`;
  return { accountId, apiKey, authHeader };
}

/**
 * Returns the inventorySystemId for this business.
 * In MySQL, it's stored in config under key "Inventory System".
 * Falls back to businessId itself if not set.
 */
export async function resolveInventorySystemId(businessId: string): Promise<string> {
  const val = await ConfigRepository.get(businessId, 'Inventory System');
  return val || businessId;
}

/** Generic Cin7 API fetch with retry / rate-limit handling. */
export async function cin7Fetch(
  url: string,
  authHeader: string,
  retryCount = 0,
  label = 'cin7',
): Promise<any> {
  const MAX_RETRIES = 3;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: any) {
    if (retryCount >= MAX_RETRIES) throw new Error(`Cin7 network error: ${e.message}`);
    await sleep(Math.pow(2, retryCount) * 3000);
    return cin7Fetch(url, authHeader, retryCount + 1, label);
  }

  if (res.status === 429) {
    if (retryCount >= MAX_RETRIES) throw new Error('Cin7 rate limit exceeded after retries.');
    console.log(`[${label}] 429 — waiting 60s before retry...`);
    await sleep(60_000);
    return cin7Fetch(url, authHeader, retryCount + 1, label);
  }
  if (res.status >= 500) {
    if (retryCount >= MAX_RETRIES) throw new Error(`Cin7 server error: HTTP ${res.status}`);
    await sleep(Math.pow(2, retryCount) * 2000);
    return cin7Fetch(url, authHeader, retryCount + 1, label);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cin7 error HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

const CIN7_BASE = 'https://api.cin7.com/api/v1';
const PAGE_SIZE = 250;
const REQUEST_DELAY_MS = 1100;

export async function cin7FetchAllPages(
  authHeader: string,
  path: string,
  extraParams: Record<string, string> = {},
  label = 'cin7',
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`${CIN7_BASE}${path}`);
    url.searchParams.set('rows', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);

    console.log(`[${label}] GET ${path} page ${page}`);
    const data = await cin7Fetch(url.toString(), authHeader, 0, label);

    let records: any[];
    if (Array.isArray(data)) {
      records = data;
    } else if (data && typeof data === 'object') {
      const wrapped = data.data ?? data.Branches ?? data.branches ?? data.records ?? data.items;
      records = Array.isArray(wrapped) ? wrapped : [];
    } else {
      records = [];
    }

    if (records.length === 0) break;
    all.push(...records);
    if (records.length < PAGE_SIZE) break;
    page++;
    await sleep(REQUEST_DELAY_MS);
  }

  return all;
}

/**
 * Like cin7FetchAllPages but processes one page at a time via a callback,
 * avoiding accumulating all records in memory. Returns total records processed.
 */
export async function cin7ForEachPage(
  authHeader: string,
  path: string,
  extraParams: Record<string, string> = {},
  label: string,
  onPage: (records: any[], pageNum: number) => Promise<void>,
): Promise<number> {
  let page = 1;
  let total = 0;
  while (true) {
    const url = new URL(`${CIN7_BASE}${path}`);
    url.searchParams.set('rows', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
    console.log(`[${label}] GET ${path} page ${page}`);
    const data = await cin7Fetch(url.toString(), authHeader, 0, label);
    let records: any[];
    if (Array.isArray(data)) {
      records = data;
    } else if (data && typeof data === 'object') {
      const wrapped = data.data ?? data.Branches ?? data.branches ?? data.records ?? data.items;
      records = Array.isArray(wrapped) ? wrapped : [];
    } else {
      records = [];
    }
    if (records.length === 0) break;
    await onPage(records, page);
    total += records.length;
    if (records.length < PAGE_SIZE) break;
    page++;
    await sleep(REQUEST_DELAY_MS);
  }
  return total;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
