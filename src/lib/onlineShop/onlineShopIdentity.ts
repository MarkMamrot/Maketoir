import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export interface OnlineShopCustomerIdentity { contactId: number; email: string; name: string }

function normalizeEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : '';
}

export async function findOnlineShopCustomerByEmail(businessId: string, rawEmail: unknown): Promise<OnlineShopCustomerIdentity | null> {
  const email = normalizeEmail(rawEmail); if (!email) return null;
  return runImsForBusiness(businessId, async () => {
    const rows = await imsQuery<{ id: number; email: string; name: string }>(
      `SELECT id, email, name FROM ims_contacts
        WHERE business_id = ? AND type = 'retail_customer' AND is_active = 1 AND LOWER(email) = ? ORDER BY id LIMIT 1`,
      [businessId, email],
    );
    return rows[0] ? { contactId: Number(rows[0].id), email: rows[0].email.toLowerCase(), name: rows[0].name } : null;
  });
}

export async function getOrCreateOnlineShopCustomer(businessId: string, rawEmail: unknown): Promise<OnlineShopCustomerIdentity> {
  const email = normalizeEmail(rawEmail); if (!email) throw new Error('A valid customer email is required.');
  const existing = await findOnlineShopCustomerByEmail(businessId, email); if (existing) return existing;
  return runImsForBusiness(businessId, async () => {
    const result = await imsExecute(
      `INSERT INTO ims_contacts (business_id, type, name, email, is_active) VALUES (?, 'retail_customer', ?, ?, 1)`,
      [businessId, email, email],
    );
    return { contactId: Number(result.insertId), email, name: email };
  });
}