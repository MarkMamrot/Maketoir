import { createHash, randomBytes } from 'node:crypto';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt, encrypt } from '@/lib/encryption';
import { getPool, query, execute } from '@/services/MySQLService';
import { KlaviyoService } from '@/services/KlaviyoService';

export const KLAVIYO_OAUTH_SCOPES = 'campaigns:read flows:read lists:read metrics:read profiles:read profiles:write events:write';

interface OAuthRow {
  access_token: string;
  refresh_token: string;
  expires_at: number | string;
}

export function klaviyoOAuthConfig() {
  const clientId = process.env.KLAVIYO_CLIENT_ID;
  const clientSecret = process.env.KLAVIYO_CLIENT_SECRET;
  const origin = process.env.APP_URL;
  if (!clientId || !clientSecret || !origin) throw new Error('Klaviyo OAuth is not configured.');
  return { clientId, clientSecret, redirectUri: new URL('/api/klaviyo/oauth/callback', origin).toString() };
}

export function createKlaviyoAuthorization(businessId: string, userId: number) {
  const config = klaviyoOAuthConfig();
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const url = new URL('https://www.klaviyo.com/oauth/authorize');
  url.search = new URLSearchParams({
    response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri,
    scope: KLAVIYO_OAUTH_SCOPES, state, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  }).toString();
  return { url: url.toString(), cookie: encrypt(JSON.stringify({
    state, verifier, businessId, userId, expiresAt: Date.now() + 600_000,
  })) };
}

export function readKlaviyoAuthorization(cookie: string, state: string, businessId: string, userId: number) {
  try {
    const value = JSON.parse(decrypt(cookie));
    if (!state || value.state !== state || value.businessId !== businessId || value.userId !== userId
      || !Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() || typeof value.verifier !== 'string') return null;
    return value as { verifier: string };
  } catch { return null; }
}

export async function exchangeKlaviyoToken(parameters: Record<string, string>, fetcher: typeof fetch = fetch) {
  const { clientId, clientSecret } = klaviyoOAuthConfig();
  const response = await fetcher('https://a.klaviyo.com/oauth/token', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error === 'invalid_grant'
    ? 'Klaviyo authorization expired. Reconnect Klaviyo.' : `Klaviyo authorization failed (HTTP ${response.status}).`);
  if (typeof body.access_token !== 'string' || !body.access_token || typeof body.refresh_token !== 'string'
    || !body.refresh_token || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
    throw new Error('Klaviyo returned an invalid token response.');
  }
  return { accessToken: body.access_token as string, refreshToken: body.refresh_token as string,
    expiresAt: Date.now() + body.expires_in * 1000, scope: String(body.scope ?? '') };
}

export async function saveKlaviyoAuthorization(businessId: string, code: string, verifier: string) {
  const tokens = await exchangeKlaviyoToken({ grant_type: 'authorization_code', code,
    code_verifier: verifier, redirect_uri: klaviyoOAuthConfig().redirectUri });
  const scopes = new Set(tokens.scope.split(' '));
  if (KLAVIYO_OAUTH_SCOPES.split(' ').some(scope => !scopes.has(scope))) {
    throw new Error('Klaviyo did not grant the required permissions. Reconnect and allow the requested access.');
  }
  await execute(`INSERT INTO klaviyo_oauth_connections
    (business_id, access_token, refresh_token, expires_at, scopes)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at), scopes = VALUES(scopes)`,
  [businessId, encrypt(tokens.accessToken), encrypt(tokens.refreshToken), tokens.expiresAt, tokens.scope]);
}

export async function hasKlaviyoOAuthConnection(businessId: string): Promise<boolean> {
  const rows = await query<{ business_id: string }>(
    'SELECT business_id FROM klaviyo_oauth_connections WHERE business_id = ?', [businessId]);
  return rows.length > 0;
}

export async function createKlaviyoClient(businessId: string): Promise<KlaviyoService> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<import('mysql2').RowDataPacket[]>(
      'SELECT access_token, refresh_token, expires_at FROM klaviyo_oauth_connections WHERE business_id = ? FOR UPDATE', [businessId]);
    const row = rows[0] as OAuthRow | undefined;
    if (!row) {
      await connection.commit();
      const legacy = await ConnectionsRepository.get(businessId);
      if (!legacy?.klaviyo_api_key) throw new Error('Connect your Klaviyo account first.');
      return new KlaviyoService(decrypt(legacy.klaviyo_api_key));
    }
    let accessToken = decrypt(row.access_token);
    if (Number(row.expires_at) <= Date.now() + 60_000) {
      const tokens = await exchangeKlaviyoToken({ grant_type: 'refresh_token', refresh_token: decrypt(row.refresh_token) });
      await connection.execute(`UPDATE klaviyo_oauth_connections
        SET access_token = ?, refresh_token = ?, expires_at = ? WHERE business_id = ?`,
      [encrypt(tokens.accessToken), encrypt(tokens.refreshToken), tokens.expiresAt, businessId]);
      accessToken = tokens.accessToken;
    }
    await connection.commit();
    return new KlaviyoService(accessToken, { authMode: 'oauth' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function disconnectKlaviyoOAuth(businessId: string) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<import('mysql2').RowDataPacket[]>(
      'SELECT refresh_token FROM klaviyo_oauth_connections WHERE business_id = ? FOR UPDATE', [businessId]);
    if (rows[0]) {
      const config = klaviyoOAuthConfig();
      const response = await fetch('https://a.klaviyo.com/oauth/revoke', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: decrypt(rows[0].refresh_token), token_type_hint: 'refresh_token' }),
      });
      if (!response.ok) throw new Error(`Klaviyo disconnect failed (HTTP ${response.status}).`);
    }
    await connection.execute('DELETE FROM klaviyo_oauth_connections WHERE business_id = ?', [businessId]);
    await connection.execute('UPDATE connections SET klaviyo_api_key = NULL WHERE business_id = ?', [businessId]);
    await connection.execute('UPDATE klaviyo_integration_settings SET enabled = 0 WHERE business_id = ?', [businessId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}