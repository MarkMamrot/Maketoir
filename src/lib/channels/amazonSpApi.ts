export const AMAZON_AU_MARKETPLACE_ID = 'A39IBJ37TRP1C6';
export const AMAZON_FAR_EAST_ENDPOINT = 'https://sellingpartnerapi-fe.amazon.com';
export const AMAZON_AU_SELLER_CENTRAL = 'https://sellercentral.amazon.com.au';

interface AmazonLwaTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface AmazonMarketplaceParticipation {
  marketplace: {
    id: string;
    countryCode: string;
    name: string;
    defaultCurrencyCode: string;
    domainName: string;
  };
  storeName: string;
  participation: {
    isParticipating: boolean;
    hasSuspendedListings: boolean;
  };
}

function amazonConfig() {
  const applicationId = String(process.env.AMAZON_SP_API_APPLICATION_ID ?? '').trim();
  const clientId = String(process.env.AMAZON_SP_API_LWA_CLIENT_ID ?? '').trim();
  const clientSecret = String(process.env.AMAZON_SP_API_LWA_CLIENT_SECRET ?? '').trim();
  if (!applicationId || !clientId || !clientSecret) {
    throw new Error('Amazon SP-API public application credentials are not configured.');
  }
  return { applicationId, clientId, clientSecret };
}

export function amazonSpApiConfigured(): boolean {
  try { amazonConfig(); return true; } catch { return false; }
}

export function buildAmazonAuthorizeUrl(state: string): string {
  const { applicationId } = amazonConfig();
  const url = new URL('/apps/authorize/consent', AMAZON_AU_SELLER_CENTRAL);
  url.searchParams.set('application_id', applicationId);
  url.searchParams.set('state', state);
  if (process.env.AMAZON_SP_API_APP_STAGE === 'draft') url.searchParams.set('version', 'beta');
  return url.toString();
}

async function requestLwaToken(
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<AmazonLwaTokenResponse> {
  const response = await fetchImpl('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as AmazonLwaTokenResponse | null;
  if (!response.ok) throw new Error(`Amazon authorization failed with HTTP ${response.status}.`);
  if (!payload?.access_token || !Number.isFinite(Number(payload.expires_in))) {
    throw new Error('Amazon returned an invalid authorization response.');
  }
  return payload;
}

export async function exchangeAmazonAuthorizationCode(
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const { clientId, clientSecret } = amazonConfig();
  const payload = await requestLwaToken(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  }), fetchImpl);
  if (!payload.refresh_token) throw new Error('Amazon did not return a refresh token.');
  return { accessToken: payload.access_token!, refreshToken: payload.refresh_token, expiresIn: Number(payload.expires_in) };
}

export async function refreshAmazonAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const { clientId, clientSecret } = amazonConfig();
  const payload = await requestLwaToken(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }), fetchImpl);
  return { accessToken: payload.access_token!, expiresIn: Number(payload.expires_in) };
}

export async function getAmazonMarketplaceParticipations(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AmazonMarketplaceParticipation[]> {
  const response = await fetchImpl(`${AMAZON_FAR_EAST_ENDPOINT}/sellers/v1/marketplaceParticipations`, {
    method: 'GET',
    headers: {
      'x-amz-access-token': accessToken,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
      'user-agent': 'Solvantis/1.0 (Language=TypeScript)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as { payload?: AmazonMarketplaceParticipation[] } | null;
  if (!response.ok) throw new Error(`Amazon marketplace check failed with HTTP ${response.status}.`);
  return Array.isArray(body?.payload) ? body.payload : [];
}

export function requireActiveAmazonAustraliaParticipation(rows: AmazonMarketplaceParticipation[]): AmazonMarketplaceParticipation {
  const australia = rows.find(row => row.marketplace?.id === AMAZON_AU_MARKETPLACE_ID);
  if (!australia) throw new Error('This seller account does not have access to Amazon Australia.');
  if (!australia.participation?.isParticipating) throw new Error('This seller account is not participating in Amazon Australia.');
  if (australia.participation.hasSuspendedListings) throw new Error('Amazon Australia listings are suspended for this seller account.');
  return australia;
}

export interface AmazonListingItem {
  sku: string;
  summaries?: Array<{ asin?: string; itemName?: string; status?: string[] }>;
  issues?: Array<{ code?: string; message?: string; severity?: string }>;
  fulfillmentAvailability?: Array<{ fulfillmentChannelCode?: string; quantity?: number }>;
}

export interface AmazonListingSubmissionIssue {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING' | 'INFO' | string;
}

export interface AmazonListingSubmission {
  sku: string;
  status: 'ACCEPTED' | 'INVALID' | 'VALID' | string;
  submissionId: string;
  issues: AmazonListingSubmissionIssue[];
}

export async function updateAmazonListingInventory(
  accessToken: string,
  sellerId: string,
  sellerSku: string,
  quantityInput: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AmazonListingSubmission> {
  const quantity = Math.max(0, Math.floor(Number(quantityInput)));
  if (!Number.isFinite(quantity)) throw new Error('Amazon inventory quantity is invalid.');
  const url = new URL(
    `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sellerSku)}`,
    AMAZON_FAR_EAST_ENDPOINT,
  );
  url.searchParams.set('marketplaceIds', AMAZON_AU_MARKETPLACE_ID);
  url.searchParams.set('includedData', 'issues');
  url.searchParams.set('issueLocale', 'en_AU');
  const response = await fetchImpl(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-amz-access-token': accessToken,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
      'user-agent': 'Solvantis/1.0 (Language=TypeScript)',
    },
    body: JSON.stringify({
      productType: 'PRODUCT',
      patches: [{
        op: 'replace',
        path: '/attributes/fulfillment_availability',
        value: [{ fulfillment_channel_code: 'DEFAULT', quantity }],
      }],
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as Partial<AmazonListingSubmission> | null;
  if (!response.ok) throw new Error(`Amazon inventory update failed with HTTP ${response.status}.`);
  if (!body?.sku || !body.status || !body.submissionId) {
    throw new Error('Amazon returned an invalid inventory update response.');
  }
  const issues = Array.isArray(body.issues) ? body.issues.map(issue => ({
    code: String(issue?.code ?? ''),
    message: String(issue?.message ?? ''),
    severity: String(issue?.severity ?? ''),
  })) : [];
  if (body.status !== 'ACCEPTED' || issues.some(issue => issue.severity === 'ERROR')) {
    const code = issues.find(issue => issue.severity === 'ERROR')?.code;
    throw new Error(`Amazon rejected the inventory update${code ? ` (${code})` : ''}.`);
  }
  return { sku: body.sku, status: body.status, submissionId: body.submissionId, issues };
}

export async function listAmazonListings(
  accessToken: string,
  sellerId: string,
  options: { pageSize?: number; nextToken?: string | null } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ items: AmazonListingItem[]; nextToken: string | null }> {
  const url = new URL(`/listings/2021-08-01/items/${encodeURIComponent(sellerId)}`, AMAZON_FAR_EAST_ENDPOINT);
  url.searchParams.set('marketplaceIds', AMAZON_AU_MARKETPLACE_ID);
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(20, Math.floor(options.pageSize ?? 20)))));
  url.searchParams.set('includedData', 'summaries,issues,fulfillmentAvailability');
  if (options.nextToken) url.searchParams.set('pageToken', options.nextToken);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      'x-amz-access-token': accessToken,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
      'user-agent': 'Solvantis/1.0 (Language=TypeScript)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as {
    items?: AmazonListingItem[];
    pagination?: { nextToken?: string };
  } | null;
  if (!response.ok) throw new Error(`Amazon listings request failed with HTTP ${response.status}.`);
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    nextToken: String(body?.pagination?.nextToken ?? '').trim() || null,
  };
}
