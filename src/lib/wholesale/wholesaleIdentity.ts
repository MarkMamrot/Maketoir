import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';
import {
  isWholesaleContactEligible,
  isWholesaleEnabled,
  parseWholesaleBrandAccess,
  type WholesaleBrandAccess,
} from './wholesaleAccess';

export interface WholesaleBuyerIdentity {
  contactId: number;
  businessId: string;
  email: string;
  name: string;
  company: string;
  companyId: number;
  locationId: number;
  memberId: number;
  memberRole: 'owner' | 'admin' | 'buyer';
  brandAccess: WholesaleBrandAccess;
}

interface WholesaleContactRow {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  type: string;
  price_tier: string | null;
  is_active: number;
  wholesale_allowed_brands_json: unknown;
  company_id: number;
  location_id: number;
  member_id: number;
  member_role: 'owner' | 'admin' | 'buyer';
  wholesale_company_name: string;
}

async function isBusinessWholesaleEnabled(businessId: string): Promise<boolean> {
  const rows = await imsQuery<{ value: string }>(
    `SELECT value FROM ims_settings
      WHERE business_id = ? AND \`key\` = 'sells_wholesale'
      LIMIT 1`,
    [businessId],
  );
  return isWholesaleEnabled(rows[0]?.value);
}

function mapIdentity(row: WholesaleContactRow, businessId: string): WholesaleBuyerIdentity {
  return {
    contactId: Number(row.id),
    businessId,
    email: row.email.trim().toLowerCase(),
    name: row.name?.trim() ?? '',
    company: row.wholesale_company_name?.trim() || row.company?.trim() || '',
    companyId: Number(row.company_id),
    locationId: Number(row.location_id),
    memberId: Number(row.member_id),
    memberRole: row.member_role,
    brandAccess: parseWholesaleBrandAccess(row.wholesale_allowed_brands_json),
  };
}

export async function findWholesaleBuyerByEmail(
  businessId: string,
  emailInput: unknown,
): Promise<WholesaleBuyerIdentity | null> {
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  if (!email || email.length > 320) return null;

  return runImsForBusiness(businessId, async () => {
    if (!await isBusinessWholesaleEnabled(businessId)) return null;

    const rows = await imsQuery<WholesaleContactRow>(
      `SELECT c.id, c.email, c.name, c.company, c.type, c.price_tier, c.is_active,
              c.wholesale_allowed_brands_json, wc.id AS company_id,
              wl.id AS location_id, wm.id AS member_id, wm.role AS member_role,
              wc.company_name AS wholesale_company_name
         FROM ims_contacts c
         JOIN ims_wholesale_company_members wm
           ON wm.business_id = c.business_id AND wm.contact_id = c.id AND wm.is_active = 1
         JOIN ims_wholesale_companies wc
           ON wc.business_id = c.business_id AND wc.id = wm.company_id AND wc.status = 'active'
         JOIN ims_wholesale_member_locations wml
           ON wml.business_id = wm.business_id AND wml.company_id = wm.company_id AND wml.member_id = wm.id
         JOIN ims_wholesale_company_locations wl
           ON wl.business_id = c.business_id AND wl.id = wml.location_id
          AND wl.company_id = wc.id AND wl.status = 'active'
        WHERE c.business_id = ? AND LOWER(c.email) = ?
        ORDER BY (wl.id = wm.location_id) DESC, wl.is_primary DESC, wm.id
        LIMIT 1`,
      [businessId, email],
    );
    const contact = rows[0];
    return contact && isWholesaleContactEligible(contact.type, contact.price_tier, contact.is_active)
      ? mapIdentity(contact, businessId)
      : null;
  });
}

export async function getActiveWholesaleBuyer(
  businessId: string,
  contactId: number,
  locationId?: number,
): Promise<WholesaleBuyerIdentity | null> {
  return runImsForBusiness(businessId, async () => {
    if (!await isBusinessWholesaleEnabled(businessId)) return null;

    const rows = await imsQuery<WholesaleContactRow>(
      `SELECT c.id, c.email, c.name, c.company, c.type, c.price_tier, c.is_active,
              c.wholesale_allowed_brands_json, wc.id AS company_id,
              wl.id AS location_id, wm.id AS member_id, wm.role AS member_role,
              wc.company_name AS wholesale_company_name
         FROM ims_contacts c
         JOIN ims_wholesale_company_members wm
           ON wm.business_id = c.business_id AND wm.contact_id = c.id AND wm.is_active = 1
         JOIN ims_wholesale_companies wc
           ON wc.business_id = c.business_id AND wc.id = wm.company_id AND wc.status = 'active'
         JOIN ims_wholesale_member_locations wml
           ON wml.business_id = wm.business_id AND wml.company_id = wm.company_id AND wml.member_id = wm.id
         JOIN ims_wholesale_company_locations wl
           ON wl.business_id = c.business_id AND wl.id = wml.location_id
          AND wl.company_id = wc.id AND wl.status = 'active'
        WHERE c.business_id = ? AND c.id = ?
          ${locationId ? 'AND wl.id = ?' : ''}
        ORDER BY (wl.id = wm.location_id) DESC, wl.is_primary DESC, wm.id
        LIMIT 1`,
      locationId ? [businessId, contactId, locationId] : [businessId, contactId],
    );
    const contact = rows[0];
    return contact && isWholesaleContactEligible(contact.type, contact.price_tier, contact.is_active)
      ? mapIdentity(contact, businessId)
      : null;
  });
}