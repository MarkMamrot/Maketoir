import { createHash } from 'crypto';
import { execute, query } from '@/services/MySQLService';

const RESERVED_WHOLESALE_SLUGS = new Set([
  'account',
  'admin',
  'api',
  'apply',
  'cart',
  'help',
  'login',
  'logout',
  'orders',
  'reset-password',
  'settings',
  'signup',
]);

export interface WholesaleSupplierProfile {
  businessId: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  supportEmail: string | null;
  isActive: boolean;
}

interface WholesaleSupplierProfileRow {
  business_id: string;
  slug: string;
  display_name: string;
  logo_url: string | null;
  support_email: string | null;
  is_active: number;
}

interface SupplierSeedRow {
  business_id: string;
  name: string;
  logo_url: string | null;
}

export function normalizeWholesaleSupplierSlug(value: unknown): string {
  if (typeof value !== 'string') return '';

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function validateWholesaleSupplierSlug(value: unknown): string {
  const slug = normalizeWholesaleSupplierSlug(value);
  if (slug.length < 3) {
    throw new Error('Wholesale supplier slug must contain at least 3 characters.');
  }
  if (RESERVED_WHOLESALE_SLUGS.has(slug)) {
    throw new Error('Wholesale supplier slug is reserved.');
  }
  return slug;
}

function mapProfile(row: WholesaleSupplierProfileRow): WholesaleSupplierProfile {
  return {
    businessId: row.business_id,
    slug: row.slug,
    displayName: row.display_name,
    logoUrl: row.logo_url,
    supportEmail: row.support_email,
    isActive: row.is_active === 1,
  };
}

export const WholesaleSupplierProfileRepository = {
  async getActiveBySlug(slugInput: unknown): Promise<WholesaleSupplierProfile | null> {
    const slug = normalizeWholesaleSupplierSlug(slugInput);
    if (!slug || RESERVED_WHOLESALE_SLUGS.has(slug)) return null;

    const rows = await query<WholesaleSupplierProfileRow>(
      `SELECT p.business_id, p.slug, p.display_name, p.logo_url, p.support_email, p.is_active
         FROM wholesale_supplier_profiles p
         JOIN businesses b ON BINARY b.business_id = BINARY p.business_id
        WHERE p.slug = ? AND p.is_active = 1 AND b.deleted_at IS NULL
        LIMIT 1`,
      [slug],
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  },

  async getByBusinessId(businessId: string): Promise<WholesaleSupplierProfile | null> {
    const rows = await query<WholesaleSupplierProfileRow>(
      `SELECT business_id, slug, display_name, logo_url, support_email, is_active
         FROM wholesale_supplier_profiles
        WHERE business_id = ?
        LIMIT 1`,
      [businessId],
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  },

  async upsert(input: {
    businessId: string;
    slug: unknown;
    displayName: string;
    logoUrl?: string | null;
    supportEmail?: string | null;
    isActive?: boolean;
  }): Promise<void> {
    const slug = validateWholesaleSupplierSlug(input.slug);
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('Wholesale supplier display name is required.');

    await execute(
      `INSERT INTO wholesale_supplier_profiles
         (business_id, slug, display_name, logo_url, support_email, is_active)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         slug = VALUES(slug),
         display_name = VALUES(display_name),
         logo_url = VALUES(logo_url),
         support_email = VALUES(support_email),
         is_active = VALUES(is_active),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [
        input.businessId,
        slug,
        displayName,
        input.logoUrl?.trim() || null,
        input.supportEmail?.trim().toLowerCase() || null,
        input.isActive === false ? 0 : 1,
      ],
    );
  },

  async ensureForBusiness(businessId: string): Promise<WholesaleSupplierProfile> {
    const existing = await this.getByBusinessId(businessId);
    if (existing) {
      if (!existing.isActive) {
        await execute(
          'UPDATE wholesale_supplier_profiles SET is_active = 1 WHERE business_id = ?',
          [businessId],
        );
      }
      return { ...existing, isActive: true };
    }

    const rows = await query<SupplierSeedRow>(
      `SELECT b.business_id, b.name, bp.logo_url
         FROM businesses b
         LEFT JOIN brand_profile bp ON BINARY bp.business_id = BINARY b.business_id
        WHERE b.business_id = ? AND b.deleted_at IS NULL
        LIMIT 1`,
      [businessId],
    );
    const business = rows[0];
    if (!business) throw new Error('Business not found for wholesale supplier profile.');

    const baseSlug = validateWholesaleSupplierSlug(business.name);
    const slugRows = await query<{ business_id: string }>(
      'SELECT business_id FROM wholesale_supplier_profiles WHERE slug = ? LIMIT 1',
      [baseSlug],
    );
    const suffix = createHash('sha256').update(businessId).digest('hex').slice(0, 8);
    const slug = slugRows[0] && slugRows[0].business_id !== businessId
      ? `${baseSlug.slice(0, 71).replace(/-+$/g, '')}-${suffix}`
      : baseSlug;

    await this.upsert({
      businessId,
      slug,
      displayName: business.name,
      logoUrl: business.logo_url,
      isActive: true,
    });
    return {
      businessId,
      slug,
      displayName: business.name,
      logoUrl: business.logo_url,
      supportEmail: null,
      isActive: true,
    };
  },

  async deactivate(businessId: string): Promise<void> {
    await execute(
      'UPDATE wholesale_supplier_profiles SET is_active = 0 WHERE business_id = ?',
      [businessId],
    );
  },
};