import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export interface LoyaltyPortalShopifyCustomer {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

export async function upsertLoyaltyPortalCustomer(
  businessId: string,
  customer: LoyaltyPortalShopifyCustomer,
): Promise<number> {
  if (!Number.isSafeInteger(customer.id) || customer.id <= 0) throw new Error('A valid Shopify customer is required.');
  const shopifyCustomerId = String(customer.id);
  const existing = await imsQuery<{ id: number }>(
    `SELECT id FROM ims_contacts
      WHERE business_id = ? AND shopify_customer_id = ? AND deleted_at IS NULL
      LIMIT 2`, [businessId, shopifyCustomerId]);
  if (existing.length > 1) throw new Error('Multiple contacts are linked to this Shopify customer.');
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email;
  if (existing[0]) {
    await imsExecute(
      `UPDATE ims_contacts SET name=?, first_name=?, last_name=?, email=?, phone=COALESCE(?, phone), is_active=1
        WHERE id=? AND business_id=? AND shopify_customer_id=?`,
      [name, customer.firstName, customer.lastName, customer.email, customer.phone,
        existing[0].id, businessId, shopifyCustomerId]);
    return Number(existing[0].id);
  }
  const result = await imsExecute(
    `INSERT INTO ims_contacts
      (business_id, type, name, first_name, last_name, email, phone, shopify_customer_id, is_active)
     VALUES (?, 'retail_customer', ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [businessId, name, customer.firstName, customer.lastName, customer.email, customer.phone, shopifyCustomerId]);
  return Number(result.insertId);
}