import { createHash } from 'crypto';

import { execute, query } from '@/services/MySQLService';
import { isOnlineSalesChannel, type OnlineSalesChannel } from '@/lib/storefront/channel';

const RESERVED_SHOP_SLUGS = new Set([
  'account', 'admin', 'api', 'cart', 'checkout', 'collections', 'login', 'logout',
  'orders', 'pages', 'products', 'reset-password', 'settings', 'signup',
]);

export interface OnlineShopProfile {
  businessId: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  supportEmail: string | null;
  defaultMetaTitle: string | null;
  defaultMetaDescription: string | null;
  isActive: boolean;
}

interface OnlineShopProfileRow {
  business_id: string;
  slug: string;
  display_name: string;
  logo_url: string | null;
  support_email: string | null;
  default_meta_title: string | null;
  default_meta_description: string | null;
  is_active: number;
}

export function normalizeOnlineShopSlug(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
    .slice(0, 80).replace(/-+$/g, '');
}

export function validateOnlineShopSlug(value: unknown): string {
  const slug = normalizeOnlineShopSlug(value);
  if (slug.length < 3) throw new Error('Online shop slug must contain at least 3 characters.');
  if (RESERVED_SHOP_SLUGS.has(slug)) throw new Error('Online shop slug is reserved.');
  return slug;
}

function mapProfile(row: OnlineShopProfileRow): OnlineShopProfile {
  return {
    businessId: row.business_id,
    slug: row.slug,
    displayName: row.display_name,
    logoUrl: row.logo_url,
    supportEmail: row.support_email,
    defaultMetaTitle: row.default_meta_title,
    defaultMetaDescription: row.default_meta_description,
    isActive: row.is_active === 1,
  };
}

export const OnlineSalesChannelRepository = {
  async get(businessId: string): Promise<OnlineSalesChannel> {
    const rows = await query<{ active_channel: string }>(
      'SELECT active_channel FROM business_online_channels WHERE business_id = ? LIMIT 1',
      [businessId],
    );
    return isOnlineSalesChannel(rows[0]?.active_channel) ? rows[0].active_channel : 'none';
  },

  async set(input: { businessId: string; channel: OnlineSalesChannel; actorUserId?: number | null; actorName?: string | null }): Promise<void> {
    await execute(
      `INSERT INTO business_online_channels
         (business_id, active_channel, changed_by_user_id, changed_by_name)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         active_channel = VALUES(active_channel),
         changed_by_user_id = VALUES(changed_by_user_id),
         changed_by_name = VALUES(changed_by_name),
         changed_at = CURRENT_TIMESTAMP(3),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [input.businessId, input.channel, input.actorUserId ?? null, input.actorName?.trim() || null],
    );
  },
};

export const OnlineShopProfileRepository = {
  async getByBusinessId(businessId: string): Promise<OnlineShopProfile | null> {
    const rows = await query<OnlineShopProfileRow>(
      `SELECT business_id, slug, display_name, logo_url, support_email,
              default_meta_title, default_meta_description, is_active
         FROM online_shop_profiles WHERE business_id = ? LIMIT 1`,
      [businessId],
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  },

  async getActiveBySlug(slugInput: unknown): Promise<OnlineShopProfile | null> {
    const slug = normalizeOnlineShopSlug(slugInput);
    if (!slug || RESERVED_SHOP_SLUGS.has(slug)) return null;
    const rows = await query<OnlineShopProfileRow>(
      `SELECT p.business_id, p.slug, p.display_name, p.logo_url, p.support_email,
              p.default_meta_title, p.default_meta_description, p.is_active
         FROM online_shop_profiles p
         JOIN business_online_channels c ON BINARY c.business_id = BINARY p.business_id
         JOIN businesses b ON BINARY b.business_id = BINARY p.business_id
        WHERE p.slug = ? AND p.is_active = 1 AND c.active_channel = 'native_shop'
          AND b.deleted_at IS NULL
        LIMIT 1`,
      [slug],
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  },

  async upsert(input: {
    businessId: string;
    slug: unknown;
    displayName: string;
    logoUrl?: string | null;
    supportEmail?: string | null;
    defaultMetaTitle?: string | null;
    defaultMetaDescription?: string | null;
    isActive?: boolean;
  }): Promise<void> {
    const slug = validateOnlineShopSlug(input.slug);
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('Online shop display name is required.');
    const supportEmail = input.supportEmail?.trim().toLowerCase() || null;
    if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) throw new Error('Enter a valid online shop support email.');
    await execute(
      `INSERT INTO online_shop_profiles
         (business_id, slug, display_name, logo_url, support_email, default_meta_title, default_meta_description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         slug = VALUES(slug), display_name = VALUES(display_name), logo_url = VALUES(logo_url),
         support_email = VALUES(support_email), default_meta_title = VALUES(default_meta_title),
         default_meta_description = VALUES(default_meta_description), is_active = VALUES(is_active),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [input.businessId, slug, displayName, input.logoUrl?.trim() || null,
        supportEmail, input.defaultMetaTitle?.trim() || null,
        input.defaultMetaDescription?.trim() || null, input.isActive === true ? 1 : 0],
    );
  },

  fallbackSlug(businessId: string, displayName: string): string {
    const base = normalizeOnlineShopSlug(displayName);
    if (base.length >= 3 && !RESERVED_SHOP_SLUGS.has(base)) return base;
    return `shop-${createHash('sha256').update(businessId).digest('hex').slice(0, 8)}`;
  },
};