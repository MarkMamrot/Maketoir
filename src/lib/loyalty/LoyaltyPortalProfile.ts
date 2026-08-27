import { execute, query } from '@/services/MySQLService';

const RESERVED_SLUGS = new Set(['admin', 'api', 'login', 'logout', 'settings']);

export interface LoyaltyPortalProfile {
  businessId: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  shopifyReturnUrl: string;
  termsUrl: string;
  termsVersion: string;
  privacyUrl: string;
  isActive: boolean;
}

interface ProfileRow {
  business_id: string; slug: string; display_name: string; logo_url: string | null;
  shopify_return_url: string; terms_url: string; terms_version: string;
  privacy_url: string; is_active: number;
}

export function normalizeLoyaltyPortalSlug(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
    .slice(0, 80).replace(/-+$/g, '');
}

function requiredHttpsUrl(value: unknown, label: string): string {
  const text = String(value ?? '').trim();
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`${label} must be a valid HTTPS URL.`); }
  if (url.protocol !== 'https:') throw new Error(`${label} must be a valid HTTPS URL.`);
  return url.toString();
}

function mapProfile(row: ProfileRow): LoyaltyPortalProfile {
  return {
    businessId: row.business_id, slug: row.slug, displayName: row.display_name,
    logoUrl: row.logo_url, shopifyReturnUrl: row.shopify_return_url,
    termsUrl: row.terms_url, termsVersion: row.terms_version,
    privacyUrl: row.privacy_url, isActive: row.is_active === 1,
  };
}

export const LoyaltyPortalProfileRepository = {
  async getByBusinessId(businessId: string): Promise<LoyaltyPortalProfile | null> {
    const rows = await query<ProfileRow>(
      `SELECT business_id, slug, display_name, logo_url, shopify_return_url,
              terms_url, terms_version, privacy_url, is_active
         FROM loyalty_portal_profiles WHERE business_id = ? LIMIT 1`, [businessId]);
    return rows[0] ? mapProfile(rows[0]) : null;
  },

  async getActiveBySlug(input: unknown): Promise<LoyaltyPortalProfile | null> {
    const slug = normalizeLoyaltyPortalSlug(input);
    if (!slug || RESERVED_SLUGS.has(slug)) return null;
    const rows = await query<ProfileRow>(
      `SELECT p.business_id, p.slug, p.display_name, p.logo_url, p.shopify_return_url,
              p.terms_url, p.terms_version, p.privacy_url, p.is_active
         FROM loyalty_portal_profiles p
         JOIN businesses b ON BINARY b.business_id = BINARY p.business_id
        WHERE p.slug = ? AND p.is_active = 1 AND b.deleted_at IS NULL LIMIT 1`, [slug]);
    return rows[0] ? mapProfile(rows[0]) : null;
  },

  async upsert(input: Omit<LoyaltyPortalProfile, 'slug' | 'isActive'> & { slug: unknown; isActive?: boolean }): Promise<void> {
    const slug = normalizeLoyaltyPortalSlug(input.slug);
    if (slug.length < 3 || RESERVED_SLUGS.has(slug)) throw new Error('Choose a valid loyalty portal slug with at least 3 characters.');
    const displayName = input.displayName.trim();
    const termsVersion = input.termsVersion.trim();
    if (!displayName || !termsVersion) throw new Error('Display name and terms version are required.');
    await execute(
      `INSERT INTO loyalty_portal_profiles
        (business_id, slug, display_name, logo_url, shopify_return_url, terms_url, terms_version, privacy_url, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE slug=VALUES(slug), display_name=VALUES(display_name), logo_url=VALUES(logo_url),
         shopify_return_url=VALUES(shopify_return_url), terms_url=VALUES(terms_url), terms_version=VALUES(terms_version),
         privacy_url=VALUES(privacy_url), is_active=VALUES(is_active), updated_at=CURRENT_TIMESTAMP(3)`,
      [input.businessId, slug, displayName, input.logoUrl?.trim() || null,
        requiredHttpsUrl(input.shopifyReturnUrl, 'Shopify return URL'), requiredHttpsUrl(input.termsUrl, 'Terms URL'),
        termsVersion, requiredHttpsUrl(input.privacyUrl, 'Privacy URL'), input.isActive ? 1 : 0],
    );
  },
};