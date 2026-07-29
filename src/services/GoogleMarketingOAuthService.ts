import { GoogleAdsApi } from 'google-ads-api';
import {
  normalizeGoogleCustomerId,
  normalizeGooglePropertyId,
  type GoogleAdsAccountOption,
  type GoogleAnalyticsPropertyOption,
} from '@/lib/googleMarketingOAuth';

const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/analytics.readonly',
];

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface AnalyticsAccountSummary {
  displayName?: string;
  propertySummaries?: Array<{ property?: string; displayName?: string }>;
}

function config() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() ?? '';
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ?? '';
  if (!clientId || !clientSecret) throw new Error('Google OAuth is not configured. Add GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET.');
  return { clientId, clientSecret, developerToken };
}

export function googleMarketingOAuthConfigurationStatus() {
  const clientIdPresent = Boolean(process.env.GOOGLE_ADS_CLIENT_ID?.trim());
  const clientSecretPresent = Boolean(process.env.GOOGLE_ADS_CLIENT_SECRET?.trim());
  const developerTokenPresent = Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim());
  return { configured: clientIdPresent && clientSecretPresent, clientIdPresent, clientSecretPresent, developerTokenPresent };
}

export function buildGoogleMarketingAuthorizeUrl(redirectUri: string, state: string): string {
  const { clientId } = config();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGoogleMarketingCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string }> {
  const { clientId, clientSecret } = config();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || body.error) throw new Error(body.error_description || body.error || `Google returned HTTP ${response.status}.`);
  if (!body.access_token || !body.refresh_token) throw new Error('Google did not return offline access. Remove Solvantis from your Google account connections and try again.');
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function refreshGoogleMarketingAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = config();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || body.error || !body.access_token) throw new Error(body.error_description || body.error || 'Google authorisation is no longer valid. Reconnect Google.');
  return body.access_token;
}

export async function listGoogleAdsAccounts(refreshToken: string): Promise<GoogleAdsAccountOption[]> {
  const { clientId, clientSecret, developerToken } = config();
  if (!developerToken) return [];
  const client = new GoogleAdsApi({ client_id: clientId, client_secret: clientSecret, developer_token: developerToken });
  const accessible = await client.listAccessibleCustomers(refreshToken);
  const resourceNames = accessible.resource_names ?? (accessible as unknown as { resourceNames?: string[] }).resourceNames ?? [];
  const ids = Array.from(new Set(resourceNames.map(name => normalizeGoogleCustomerId(name.replace(/^customers\//, ''))).filter((id): id is string => Boolean(id))));
  const accounts: GoogleAdsAccountOption[] = [];
  for (const customerId of ids) {
    try {
      const customer = client.Customer({ customer_id: customerId, refresh_token: refreshToken });
      const rows = await customer.query('SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1') as Array<Record<string, any>>;
      const row = rows[0]?.customer ?? {};
      accounts.push({ customerId, name: String(row.descriptive_name ?? `Google Ads ${customerId}`), manager: Boolean(row.manager) });
    } catch {
      accounts.push({ customerId, name: `Google Ads ${customerId}`, manager: false });
    }
  }
  return accounts.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listGoogleAnalyticsProperties(accessToken: string): Promise<GoogleAnalyticsPropertyOption[]> {
  const properties: GoogleAnalyticsPropertyOption[] = [];
  let pageToken = '';
  for (let page = 0; page < 20; page += 1) {
    const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as { accountSummaries?: AnalyticsAccountSummary[]; nextPageToken?: string; error?: { message?: string } };
    if (!response.ok || body.error) throw new Error(body.error?.message || `Google Analytics returned HTTP ${response.status}.`);
    for (const account of body.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        const propertyId = normalizeGooglePropertyId(property.property);
        if (!propertyId || properties.some(item => item.propertyId === propertyId)) continue;
        properties.push({ propertyId, name: property.displayName?.trim() || `GA4 property ${propertyId}`, accountName: account.displayName?.trim() || 'Google Analytics' });
      }
    }
    if (!body.nextPageToken || body.nextPageToken === pageToken) break;
    pageToken = body.nextPageToken;
  }
  return properties.sort((left, right) => left.name.localeCompare(right.name));
}
