import { randomBytes } from 'crypto';
import { resolveCname, resolveTxt } from 'dns/promises';
import { domainToASCII } from 'url';

import { execute, query } from '@/services/MySQLService';

export interface OnlineShopDomain {
  businessId: string;
  domainName: string;
  verificationToken: string;
  status: 'pending' | 'verified' | 'error';
  isActive: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  safeError: string | null;
}

interface DomainRow {
  business_id: string; domain_name: string; verification_token: string; status: OnlineShopDomain['status'];
  is_active: number; verified_at: string | null; last_checked_at: string | null; safe_error: string | null;
}

export function normalizeOnlineShopDomain(value: unknown): string {
  if (typeof value !== 'string') return '';
  const input = value.trim().toLowerCase().replace(/\.$/, '');
  if (!input || input.includes('/') || input.includes(':') || input.includes('@')) return '';
  const ascii = domainToASCII(input);
  if (!ascii || ascii.length > 253 || !ascii.includes('.')) return '';
  const labels = ascii.split('.');
  if (labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return '';
  if (ascii === 'solvantis.com.au' || ascii.endsWith('.solvantis.com.au') || ascii.endsWith('.railway.app') || ascii.endsWith('.vercel.app')) return '';
  return ascii;
}

function mapDomain(row: DomainRow): OnlineShopDomain {
  return { businessId: row.business_id, domainName: row.domain_name, verificationToken: row.verification_token,
    status: row.status, isActive: row.is_active === 1, verifiedAt: row.verified_at, lastCheckedAt: row.last_checked_at,
    safeError: row.safe_error };
}

function cnameTarget(): string {
  const configured = domainToASCII(String(process.env.ONLINE_SHOP_CNAME_TARGET ?? '').trim().toLowerCase().replace(/\.$/, ''));
  if (configured && configured.includes('.') && configured.length <= 253) return configured;
  try { return new URL(process.env.APP_URL ?? 'https://solvantis.com.au').hostname.toLowerCase(); }
  catch { return 'solvantis.com.au'; }
}

export const OnlineShopDomainRepository = {
  async get(businessId: string): Promise<OnlineShopDomain | null> {
    const rows = await query<DomainRow>(
      `SELECT business_id, domain_name, verification_token, status, is_active, verified_at, last_checked_at, safe_error
         FROM online_shop_domains WHERE business_id = ? LIMIT 1`, [businessId],
    );
    return rows[0] ? mapDomain(rows[0]) : null;
  },

  async getActiveBusinessId(domainInput: unknown): Promise<string | null> {
    const domain = normalizeOnlineShopDomain(domainInput);
    if (!domain) return null;
    const rows = await query<{ business_id: string }>(
      `SELECT d.business_id FROM online_shop_domains d
       JOIN online_shop_profiles p ON BINARY p.business_id = BINARY d.business_id
       JOIN business_online_channels c ON BINARY c.business_id = BINARY d.business_id
       JOIN businesses b ON BINARY b.business_id = BINARY d.business_id
      WHERE d.domain_name = ? AND d.status = 'verified' AND d.is_active = 1
        AND p.is_active = 1 AND c.native_shop_enabled = 1 AND b.deleted_at IS NULL LIMIT 1`,
      [domain],
    );
    return rows[0]?.business_id ?? null;
  },

  async matchesVerificationToken(domainInput: unknown, token: unknown): Promise<boolean> {
    const domain = normalizeOnlineShopDomain(domainInput);
    if (!domain || typeof token !== 'string' || !/^[0-9a-f]{48}$/.test(token)) return false;
    const rows = await query<{ business_id: string }>(
      'SELECT business_id FROM online_shop_domains WHERE domain_name = ? AND verification_token = ? LIMIT 1',
      [domain, token],
    );
    return rows.length > 0;
  },

  async save(businessId: string, domainInput: unknown): Promise<OnlineShopDomain> {
    const domain = normalizeOnlineShopDomain(domainInput);
    if (!domain) throw new Error('Enter a valid custom domain without a protocol or path.');
    const token = randomBytes(24).toString('hex');
    await execute(
      `INSERT INTO online_shop_domains (business_id, domain_name, verification_token, status, is_active)
       VALUES (?, ?, ?, 'pending', 0)
       ON DUPLICATE KEY UPDATE domain_name = VALUES(domain_name), verification_token = CASE
         WHEN domain_name = VALUES(domain_name) THEN verification_token ELSE VALUES(verification_token) END,
         status = CASE WHEN domain_name = VALUES(domain_name) THEN status ELSE 'pending' END,
         is_active = CASE WHEN domain_name = VALUES(domain_name) THEN is_active ELSE 0 END,
         verified_at = CASE WHEN domain_name = VALUES(domain_name) THEN verified_at ELSE NULL END,
         last_checked_at = NULL, safe_error = NULL`,
      [businessId, domain, token],
    );
    return (await this.get(businessId))!;
  },

  async verify(businessId: string): Promise<OnlineShopDomain> {
    const current = await this.get(businessId);
    if (!current) throw new Error('Save a custom domain before verifying it.');
    const expectedTxt = `solvantis-shop-verification=${current.verificationToken}`;
    let txtVerified = false;
    let cnameVerified = false;
    try {
      const records = await resolveTxt(`_solvantis-shop.${current.domainName}`);
      txtVerified = records.some(parts => parts.join('') === expectedTxt);
    } catch {}
    try {
      const targets = await resolveCname(current.domainName);
      const expectedTarget = cnameTarget();
      cnameVerified = targets.some(target => target.toLowerCase().replace(/\.$/, '') === expectedTarget);
    } catch {}
    let httpsVerified = false;
    if (txtVerified && cnameVerified) {
      try {
        const probe = new URL(`https://${current.domainName}/api/shop/domain/verify`);
        probe.searchParams.set('token', current.verificationToken);
        const response = await fetch(probe, { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
        httpsVerified = response.ok && Boolean((await response.json()).verified);
      } catch {}
    }
    const verified = txtVerified && cnameVerified && httpsVerified;
    const safeError = verified ? null : !txtVerified && !cnameVerified ? 'Ownership TXT and CNAME records were not found.'
      : !txtVerified ? 'Ownership TXT record was not found.' : !cnameVerified ? 'CNAME does not point to the configured shop target.'
        : 'HTTPS routing and its certificate are not ready. Complete custom-domain setup with your hosting administrator.';
    await execute(
      `UPDATE online_shop_domains SET status = ?, is_active = ?, verified_at = CASE WHEN ? = 1 THEN COALESCE(verified_at, CURRENT_TIMESTAMP(3)) ELSE verified_at END,
         last_checked_at = CURRENT_TIMESTAMP(3), safe_error = ? WHERE business_id = ?`,
      [verified ? 'verified' : 'error', verified ? 1 : 0, verified ? 1 : 0, safeError, businessId],
    );
    return (await this.get(businessId))!;
  },

  async remove(businessId: string): Promise<void> {
    await execute('DELETE FROM online_shop_domains WHERE business_id = ?', [businessId]);
  },

  verificationRecords(domain: OnlineShopDomain) {
    return { txtHost: `_solvantis-shop.${domain.domainName}`, txtValue: `solvantis-shop-verification=${domain.verificationToken}`,
      cnameHost: domain.domainName, cnameTarget: cnameTarget() };
  },
};