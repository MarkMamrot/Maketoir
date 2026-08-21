import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';
import { isWholesaleContactEligible, isWholesaleEnabled } from './wholesaleAccess';

export interface WholesaleBuyerIdentity {
  contactId: number;
  businessId: string;
  email: string;
  name: string;
  company: string;
}

interface WholesaleContactRow {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  type: string;
  price_tier: string | null;
  is_active: number;
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
    company: row.company?.trim() ?? '',
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
      `SELECT id, email, name, company, type, price_tier, is_active
         FROM ims_contacts
        WHERE business_id = ? AND LOWER(email) = ?
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
): Promise<WholesaleBuyerIdentity | null> {
  return runImsForBusiness(businessId, async () => {
    if (!await isBusinessWholesaleEnabled(businessId)) return null;

    const rows = await imsQuery<WholesaleContactRow>(
      `SELECT id, email, name, company, type, price_tier, is_active
         FROM ims_contacts
        WHERE business_id = ? AND id = ?
        LIMIT 1`,
      [businessId, contactId],
    );
    const contact = rows[0];
    return contact && isWholesaleContactEligible(contact.type, contact.price_tier, contact.is_active)
      ? mapIdentity(contact, businessId)
      : null;
  });
}