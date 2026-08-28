import crypto from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { getPool, query } from '@/services/MySQLService';
import { buildHostedLoyaltyPolicies, type LoyaltyPolicyMerchantDetails } from './LoyaltyPolicyTemplates';

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
  policyMode: LoyaltyPolicyMode;
  merchant: LoyaltyPolicyMerchantDetails;
  currentPolicyVersionId: number | null;
  isActive: boolean;
}

export type LoyaltyPolicyMode = 'hosted' | 'external';

export interface LoyaltyPolicyVersion {
  id: number;
  businessId: string;
  version: string;
  policyMode: LoyaltyPolicyMode;
  termsUrl: string;
  privacyUrl: string;
  termsMarkdown: string | null;
  privacyMarkdown: string | null;
  publishedAt: string;
}

export interface LoyaltyPortalProfileInput {
  businessId: string;
  slug: unknown;
  displayName: string;
  logoUrl: string | null;
  shopifyReturnUrl: string;
  termsUrl: string;
  termsVersion: string;
  privacyUrl: string;
  policyMode: LoyaltyPolicyMode;
  merchant: Partial<LoyaltyPolicyMerchantDetails>;
  isActive?: boolean;
  policyApproved?: boolean;
  approvedBy: { userId: number; name: string };
}

interface ProfileRow {
  business_id: string; slug: string; display_name: string; logo_url: string | null;
  shopify_return_url: string; terms_url: string; terms_version: string;
  privacy_url: string; policy_mode: string; legal_name: string | null; trading_name: string | null;
  business_number: string | null; policy_contact_email: string | null; policy_contact_address: string | null;
  policy_jurisdiction: string | null; current_policy_version_id: number | null; is_active: number;
}

interface PolicyVersionRow extends RowDataPacket {
  id: number; business_id: string; version: string; policy_mode: string; terms_url: string; privacy_url: string;
  terms_markdown: string | null; privacy_markdown: string | null; published_at: string;
}

function isPolicySchemaMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error.code === 'ER_BAD_FIELD_ERROR' || error.code === 'ER_NO_SUCH_TABLE'));
}

export function normalizeLoyaltyPortalSlug(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
    .slice(0, 80).replace(/-+$/g, '');
}

export function requiredHttpsUrl(value: unknown, label: string): string {
  const text = String(value ?? '').trim();
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`${label} must be a valid HTTPS URL.`); }
  if (url.protocol !== 'https:') throw new Error(`${label} must be a valid HTTPS URL.`);
  return url.toString();
}

function hostedOrigin(): string {
  const raw = String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://solvantis.com.au').trim();
  const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('The Solvantis application URL must use HTTPS.');
  return url.origin;
}

function policyMode(value: unknown): LoyaltyPolicyMode {
  if (value === 'hosted' || value === 'external') return value;
  throw new Error('Choose hosted or external loyalty policies.');
}

function mapProfile(row: ProfileRow): LoyaltyPortalProfile {
  return {
    businessId: row.business_id, slug: row.slug, displayName: row.display_name,
    logoUrl: row.logo_url, shopifyReturnUrl: row.shopify_return_url,
    termsUrl: row.terms_url, termsVersion: row.terms_version,
    privacyUrl: row.privacy_url, policyMode: row.policy_mode === 'hosted' ? 'hosted' : 'external',
    merchant: {
      legalName: row.legal_name ?? '', tradingName: row.trading_name ?? '', businessNumber: row.business_number ?? '',
      contactEmail: row.policy_contact_email ?? '', contactAddress: row.policy_contact_address ?? '',
      jurisdiction: row.policy_jurisdiction ?? 'New South Wales, Australia',
    },
    currentPolicyVersionId: row.current_policy_version_id == null ? null : Number(row.current_policy_version_id),
    isActive: row.is_active === 1,
  };
}

const PROFILE_COLUMNS = [
  'business_id', 'slug', 'display_name', 'logo_url', 'shopify_return_url', 'terms_url', 'terms_version',
  'privacy_url', 'policy_mode', 'legal_name', 'trading_name', 'business_number', 'policy_contact_email',
  'policy_contact_address', 'policy_jurisdiction', 'current_policy_version_id', 'is_active',
];

function profileColumns(alias?: string): string {
  return PROFILE_COLUMNS.map(column => alias ? `${alias}.${column}` : column).join(', ');
}

function mapPolicyVersion(row: PolicyVersionRow): LoyaltyPolicyVersion {
  return {
    id: Number(row.id), businessId: row.business_id, version: row.version,
    policyMode: row.policy_mode === 'hosted' ? 'hosted' : 'external', termsUrl: row.terms_url,
    privacyUrl: row.privacy_url, termsMarkdown: row.terms_markdown,
    privacyMarkdown: row.privacy_markdown, publishedAt: row.published_at,
  };
}

export const LoyaltyPortalProfileRepository = {
  async getByBusinessId(businessId: string): Promise<LoyaltyPortalProfile | null> {
    const rows = await query<ProfileRow>(
      `SELECT ${profileColumns()}
         FROM loyalty_portal_profiles WHERE business_id = ? LIMIT 1`, [businessId]);
    return rows[0] ? mapProfile(rows[0]) : null;
  },

  async getActiveBySlug(input: unknown): Promise<LoyaltyPortalProfile | null> {
    const slug = normalizeLoyaltyPortalSlug(input);
    if (!slug || RESERVED_SLUGS.has(slug)) return null;
    try {
      const rows = await query<ProfileRow>(
        `SELECT ${profileColumns('p')}
           FROM loyalty_portal_profiles p
           JOIN businesses b ON BINARY b.business_id = BINARY p.business_id
          WHERE p.slug = ? AND p.is_active = 1 AND b.deleted_at IS NULL LIMIT 1`, [slug]);
      return rows[0] ? mapProfile(rows[0]) : null;
    } catch (error) {
      if (!isPolicySchemaMissing(error)) throw error;
      const rows = await query<any>(
        `SELECT p.business_id, p.slug, p.display_name, p.logo_url, p.shopify_return_url,
                p.terms_url, p.terms_version, p.privacy_url, p.is_active
           FROM loyalty_portal_profiles p
           JOIN businesses b ON BINARY b.business_id = BINARY p.business_id
          WHERE p.slug = ? AND p.is_active = 1 AND b.deleted_at IS NULL LIMIT 1`, [slug]);
      if (!rows[0]) return null;
      return mapProfile({
        ...rows[0], policy_mode: 'external', legal_name: null, trading_name: null, business_number: null,
        policy_contact_email: null, policy_contact_address: null, policy_jurisdiction: null,
        current_policy_version_id: null,
      });
    }
  },

  async getPublishedPolicyBySlug(input: unknown, requestedVersion?: unknown): Promise<LoyaltyPolicyVersion | null> {
    const slug = normalizeLoyaltyPortalSlug(input);
    if (!slug || RESERVED_SLUGS.has(slug)) return null;
    const version = String(requestedVersion ?? '').trim();
    const rows = await query<PolicyVersionRow>(
      `SELECT v.id, v.business_id, v.version, v.policy_mode, v.terms_url, v.privacy_url,
              v.terms_markdown, v.privacy_markdown, v.published_at
         FROM loyalty_portal_profiles p
         JOIN loyalty_policy_versions v ON BINARY v.business_id = BINARY p.business_id
          AND v.id = ${version ? '(SELECT selected.id FROM loyalty_policy_versions selected WHERE BINARY selected.business_id = BINARY p.business_id AND selected.version = ? LIMIT 1)' : 'p.current_policy_version_id'}
         JOIN businesses b ON BINARY b.business_id = BINARY p.business_id
        WHERE p.slug = ? AND b.deleted_at IS NULL LIMIT 1`, version ? [version, slug] : [slug]);
    return rows[0] ? mapPolicyVersion(rows[0]) : null;
  },

  async upsert(input: LoyaltyPortalProfileInput): Promise<void> {
    const slug = normalizeLoyaltyPortalSlug(input.slug);
    if (slug.length < 3 || RESERVED_SLUGS.has(slug)) throw new Error('Choose a valid loyalty portal slug with at least 3 characters.');
    const displayName = input.displayName.trim();
    const termsVersion = input.termsVersion.trim();
    if (!displayName || !termsVersion) throw new Error('Display name and terms version are required.');
    if (termsVersion.length > 100) throw new Error('Terms version must be 100 characters or fewer.');
    const mode = policyMode(input.policyMode);
    const shopifyReturnUrl = requiredHttpsUrl(input.shopifyReturnUrl, 'Shopify return URL');
    const hosted = mode === 'hosted' ? buildHostedLoyaltyPolicies(input.merchant) : null;
    const merchant = hosted?.merchant ?? {
      legalName: String(input.merchant.legalName ?? '').trim(), tradingName: String(input.merchant.tradingName ?? '').trim(),
      businessNumber: String(input.merchant.businessNumber ?? '').trim(), contactEmail: String(input.merchant.contactEmail ?? '').trim(),
      contactAddress: String(input.merchant.contactAddress ?? '').trim(), jurisdiction: String(input.merchant.jurisdiction ?? '').trim(),
    };
    const termsUrl = mode === 'hosted'
      ? `${hostedOrigin()}/rewards/${encodeURIComponent(slug)}/terms?version=${encodeURIComponent(termsVersion)}`
      : requiredHttpsUrl(input.termsUrl, 'Terms URL');
    const privacyUrl = mode === 'hosted'
      ? `${hostedOrigin()}/rewards/${encodeURIComponent(slug)}/privacy?version=${encodeURIComponent(termsVersion)}`
      : requiredHttpsUrl(input.privacyUrl, 'Privacy URL');
    if (input.isActive && input.policyApproved !== true) throw new Error('Confirm that the business has reviewed and approved the current policies before publishing.');

    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [existingProfiles] = await connection.execute<ProfileRow[] & RowDataPacket[]>(
        'SELECT business_id FROM loyalty_portal_profiles WHERE business_id = ? FOR UPDATE', [input.businessId]);
      let policyVersionId: number | null = null;
      if (input.isActive) {
        const snapshot = JSON.stringify(merchant);
        const contentHash = hosted?.contentHash ?? crypto.createHash('sha256').update(JSON.stringify({ mode, termsVersion, termsUrl, privacyUrl })).digest('hex');
        const [existingVersions] = await connection.execute<PolicyVersionRow[]>(
          'SELECT id, content_hash FROM loyalty_policy_versions WHERE business_id = ? AND version = ? LIMIT 1',
          [input.businessId, termsVersion]);
        if (existingVersions[0] && String((existingVersions[0] as any).content_hash) !== contentHash) {
          throw new Error('That terms version is already published with different content. Increase the terms version before publishing changes.');
        }
        if (existingVersions[0]) policyVersionId = Number(existingVersions[0].id);
        else {
          const [insert] = await connection.execute<ResultSetHeader>(
            `INSERT INTO loyalty_policy_versions
              (business_id, version, policy_mode, terms_url, privacy_url, terms_markdown, privacy_markdown,
               merchant_snapshot_json, template_version, content_hash, approved_by_user_id, approved_by_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [input.businessId, termsVersion, mode, termsUrl, privacyUrl, hosted?.termsMarkdown ?? null,
              hosted?.privacyMarkdown ?? null, snapshot, hosted?.templateVersion ?? null, contentHash,
              input.approvedBy.userId, input.approvedBy.name.trim() || `User ${input.approvedBy.userId}`]);
          policyVersionId = Number(insert.insertId);
        }
      }

      const values = [input.businessId, slug, displayName, input.logoUrl?.trim() || null, shopifyReturnUrl,
        termsUrl, termsVersion, privacyUrl, mode, merchant.legalName || null, merchant.tradingName || null,
        merchant.businessNumber || null, merchant.contactEmail || null, merchant.contactAddress || null,
        merchant.jurisdiction || null, policyVersionId, input.isActive ? 1 : 0];
      if (existingProfiles.length) {
        await connection.execute(
          `UPDATE loyalty_portal_profiles SET slug=?, display_name=?, logo_url=?, shopify_return_url=?, terms_url=?,
             terms_version=?, privacy_url=?, policy_mode=?, legal_name=?, trading_name=?, business_number=?,
             policy_contact_email=?, policy_contact_address=?, policy_jurisdiction=?,
             current_policy_version_id=COALESCE(?, current_policy_version_id), is_active=?, updated_at=CURRENT_TIMESTAMP(3)
           WHERE business_id=?`, [...values.slice(1), input.businessId]);
      } else {
        await connection.execute(
          `INSERT INTO loyalty_portal_profiles
            (business_id, slug, display_name, logo_url, shopify_return_url, terms_url, terms_version, privacy_url,
             policy_mode, legal_name, trading_name, business_number, policy_contact_email, policy_contact_address,
             policy_jurisdiction, current_policy_version_id, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};