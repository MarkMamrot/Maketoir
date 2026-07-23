import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { imsExecute } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

type SyncableContact = {
  id: number;
  type?: string;
  is_active?: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  shopify_customer_id?: string | null;
};

export type ShopifyCustomerSyncResult =
  | { success: true; action: 'created' | 'updated' | 'linked'; shopifyCustomerId: string }
  | { success: false; action: 'skipped' | 'error'; reason: string; shopifyCustomerId?: string | null };

export function shouldSyncRetailCustomer(contact: Pick<SyncableContact, 'type'>) {
  return contact.type === 'retail_customer';
}

export function buildShopifyCustomerPayload(contact: Pick<SyncableContact, 'name' | 'first_name' | 'last_name' | 'email' | 'phone' | 'mobile'>) {
  const clean = (value: string | null | undefined) => {
    const trimmed = String(value ?? '').trim();
    return trimmed || undefined;
  };

  const payload: Record<string, string> = {};
  const firstName = clean(contact.first_name) ?? clean(contact.name);
  const lastName = clean(contact.last_name);
  const email = clean(contact.email);
  const phone = clean(contact.mobile) ?? clean(contact.phone);

  if (firstName) payload.first_name = firstName;
  if (lastName) payload.last_name = lastName;
  if (email) payload.email = email;
  if (phone) payload.phone = phone;

  return payload;
}

function scopeHint(message: string) {
  return /403|scope|permission|access denied|write_customers|read_customers/i.test(message)
    ? `${message} Check your Shopify app has read_customers and write_customers scopes, then refresh the access token in Setup -> Connections.`
    : message;
}

export async function syncRetailCustomerToShopify(contact: SyncableContact, businessId: string): Promise<ShopifyCustomerSyncResult> {
  if (!shouldSyncRetailCustomer(contact)) {
    return { success: false, action: 'skipped', reason: 'Only retail customers sync to Shopify in v1.', shopifyCustomerId: contact.shopify_customer_id ?? null };
  }

  const conn = await ConnectionsRepository.get(businessId);
  if (!conn?.shopify_shop_id || !conn?.shopify_access_token) {
    return { success: false, action: 'skipped', reason: 'Shopify credentials not configured.', shopifyCustomerId: contact.shopify_customer_id ?? null };
  }

  let token = conn.shopify_access_token;
  try { token = decrypt(token); } catch { /* unencrypted */ }
  const shopify = new ShopifyService(conn.shopify_shop_id, token);

  if (Number(contact.is_active ?? 1) === 0) {
    if (!contact.shopify_customer_id) {
      return { success: false, action: 'skipped', reason: 'Inactive retail customer has no linked Shopify customer ID to disable.', shopifyCustomerId: null };
    }
    try {
      await shopify.disableCustomer(contact.shopify_customer_id);
      return { success: true, action: 'updated', shopifyCustomerId: String(contact.shopify_customer_id) };
    } catch (e: any) {
      return { success: false, action: 'error', reason: scopeHint(e.message ?? 'Failed to disable Shopify customer.'), shopifyCustomerId: contact.shopify_customer_id ?? null };
    }
  }

  const payload = buildShopifyCustomerPayload(contact);
  if (!Object.keys(payload).length) {
    return { success: false, action: 'skipped', reason: 'Retail customer has no Shopify-syncable fields.', shopifyCustomerId: contact.shopify_customer_id ?? null };
  }

  try {
    if (contact.shopify_customer_id) {
      // Best-effort reactivation: keep IMS active state aligned for previously disabled Shopify customers.
      await shopify.enableCustomer(contact.shopify_customer_id).catch(() => {});
      await shopify.updateCustomer(contact.shopify_customer_id, payload);
      return { success: true, action: 'updated', shopifyCustomerId: String(contact.shopify_customer_id) };
    }

    const email = payload.email;
    if (email) {
      const existing = await shopify.findCustomerByEmail(email);
      if (existing) {
        await shopify.updateCustomer(existing.id, payload);
        await imsExecute('UPDATE ims_contacts SET shopify_customer_id = ? WHERE id = ?', [String(existing.id), contact.id]);
        return { success: true, action: 'linked', shopifyCustomerId: String(existing.id) };
      }
    }

    const created = await shopify.createCustomer(payload);
    await imsExecute('UPDATE ims_contacts SET shopify_customer_id = ? WHERE id = ?', [String(created.id), contact.id]);
    return { success: true, action: 'created', shopifyCustomerId: String(created.id) };
  } catch (e: any) {
    return { success: false, action: 'error', reason: scopeHint(e.message ?? 'Shopify customer sync failed.'), shopifyCustomerId: contact.shopify_customer_id ?? null };
  }
}