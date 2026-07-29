import { createHmac, timingSafeEqual } from 'crypto';

export interface MetaOAuthState {
  businessId: string;
  userId: number;
  nonce: string;
  expiresAt: number;
}

export interface MetaAdAccountOption {
  id: string;
  accountId: string;
  name: string;
  currency: string | null;
  accountStatus: number | null;
}

function stateSecret(): string {
  const value = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY || process.env.CRON_SECRET || '';
  if (!value) throw new Error('OAUTH_STATE_SECRET or ENCRYPTION_KEY must be configured.');
  return value;
}

export function signMetaOAuthState(state: MetaOAuthState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  const signature = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyMetaOAuthState(value: string, now = Date.now()): MetaOAuthState | null {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', stateSecret()).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MetaOAuthState;
    if (!parsed.businessId || !Number.isInteger(parsed.userId) || parsed.userId <= 0 || !parsed.nonce || parsed.expiresAt < now) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function normalizeMetaAdAccount(value: unknown): MetaAdAccountOption | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const accountId = String(row.account_id ?? row.id ?? '').replace(/^act_/i, '').trim();
  if (!/^\d+$/.test(accountId)) return null;
  const status = Number(row.account_status);
  return {
    id: `act_${accountId}`,
    accountId,
    name: String(row.name ?? `Ad account ${accountId}`).trim() || `Ad account ${accountId}`,
    currency: typeof row.currency === 'string' && row.currency.trim() ? row.currency.trim() : null,
    accountStatus: Number.isInteger(status) ? status : null,
  };
}