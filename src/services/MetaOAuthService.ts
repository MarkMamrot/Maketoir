import { normalizeMetaAdAccount, type MetaAdAccountOption } from '@/lib/metaOAuth';

interface MetaTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

function graphVersion(): string {
  return (process.env.META_GRAPH_API_VERSION || 'v25.0').replace(/^\/?/, '').replace(/\/$/, '');
}

function config() {
  const appId = process.env.META_APP_ID?.trim() ?? '';
  const appSecret = process.env.META_APP_SECRET?.trim() ?? '';
  if (!appId || !appSecret) throw new Error('Meta OAuth is not configured. Add META_APP_ID and META_APP_SECRET.');
  return { appId, appSecret };
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok || body.error) throw new Error(body.error?.message || `Meta returned HTTP ${response.status}.`);
  return body;
}

export function metaOAuthConfigured(): boolean {
  return Boolean(process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim());
}

export function metaOAuthConfigurationStatus() {
  const appIdPresent = Boolean(process.env.META_APP_ID?.trim());
  const appSecretPresent = Boolean(process.env.META_APP_SECRET?.trim());
  return { configured: appIdPresent && appSecretPresent, appIdPresent, appSecretPresent };
}

export function buildMetaAuthorizeUrl(redirectUri: string, state: string): string {
  const { appId } = config();
  const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'ads_read,business_management');
  return url.toString();
}

export async function exchangeMetaCode(code: string, redirectUri: string): Promise<string> {
  const { appId, appSecret } = config();
  const shortResponse = await fetch(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }),
    cache: 'no-store',
  });
  const shortToken = await jsonResponse<MetaTokenResponse>(shortResponse);
  if (!shortToken.access_token) throw new Error('Meta did not return an access token.');

  const longUrl = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
  longUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longUrl.searchParams.set('client_id', appId);
  longUrl.searchParams.set('client_secret', appSecret);
  longUrl.searchParams.set('fb_exchange_token', shortToken.access_token);
  const longResponse = await fetch(longUrl, { cache: 'no-store' });
  const longToken = await jsonResponse<MetaTokenResponse>(longResponse);
  if (!longToken.access_token) throw new Error('Meta did not return a long-lived access token.');
  return longToken.access_token;
}

export async function listMetaAdAccounts(accessToken: string): Promise<MetaAdAccountOption[]> {
  const accounts: MetaAdAccountOption[] = [];
  let after = '';
  for (let page = 0; page < 10; page += 1) {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/me/adaccounts`);
    url.searchParams.set('fields', 'id,account_id,name,currency,account_status');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
    const body = await jsonResponse<{ data?: unknown[]; paging?: { cursors?: { after?: string }; next?: string } }>(response);
    for (const row of body.data ?? []) {
      const account = normalizeMetaAdAccount(row);
      if (account && !accounts.some((item) => item.accountId === account.accountId)) accounts.push(account);
    }
    const nextAfter = body.paging?.cursors?.after ?? '';
    if (!body.paging?.next || !nextAfter || nextAfter === after) break;
    after = nextAfter;
  }
  return accounts.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readMetaAdAccount(accessToken: string, accountId: string): Promise<MetaAdAccountOption> {
  const normalizedId = accountId.replace(/^act_/i, '').trim();
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/act_${normalizedId}`);
  url.searchParams.set('fields', 'id,account_id,name,currency,account_status');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const account = normalizeMetaAdAccount(await jsonResponse<unknown>(response));
  if (!account) throw new Error('Meta returned an invalid ad account.');
  return account;
}