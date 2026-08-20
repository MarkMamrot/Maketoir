import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

type ShopifyOrderCustomer = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
};

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export function getShopifyOrderCustomerId(order: unknown): string | null {
  if (!order || typeof order !== 'object') return null;
  const customer = (order as { customer?: unknown }).customer;
  if (!customer || typeof customer !== 'object') return null;
  const rawId = (customer as { id?: unknown }).id;
  const id = String(rawId ?? '').trim();
  return /^\d+$/.test(id) && id !== '0' ? id : null;
}

export function parseShopifyOrderCustomer(order: unknown): ShopifyOrderCustomer | null {
  const id = getShopifyOrderCustomerId(order);
  if (!id || !order || typeof order !== 'object') return null;
  const customer = (order as { customer?: unknown }).customer;
  if (!customer || typeof customer !== 'object') return null;
  const value = customer as Record<string, unknown>;
  const address = value.default_address && typeof value.default_address === 'object'
    ? value.default_address as Record<string, unknown>
    : {};
  const firstName = cleanString(value.first_name, 100);
  const lastName = cleanString(value.last_name, 100);
  const name = [firstName, lastName].filter(Boolean).join(' ')
    || cleanString(value.email, 255)
    || `Shopify Customer ${id}`;

  return {
    id,
    name: name.slice(0, 255),
    firstName,
    lastName,
    email: cleanString(value.email, 255),
    phone: cleanString(value.phone, 50),
    address: cleanString(address.address1, 65_535),
    address2: cleanString(address.address2, 255),
    city: cleanString(address.city, 100),
    state: cleanString(address.province, 100),
    postcode: cleanString(address.zip, 20),
    country: cleanString(address.country, 100),
  };
}

export async function resolveShopifyOrderCustomerId(
  businessId: string,
  order: unknown,
  fallbackCustomerId: number | null = null,
  options: { createIfMissing?: boolean } = {},
): Promise<number | null> {
  const customer = parseShopifyOrderCustomer(order);
  if (!customer) return fallbackCustomerId;

  const rows = await imsQuery<{ id: number }>(
    `SELECT id
       FROM ims_contacts
      WHERE business_id = ? AND shopify_customer_id = ?
      LIMIT 1`,
    [businessId, customer.id],
  );
  if (rows[0]) return Number(rows[0].id);
  if (!options.createIfMissing) return fallbackCustomerId;

  const result = await imsExecute(
    `INSERT INTO ims_contacts
       (business_id, type, name, first_name, last_name, email, phone, address, address2,
        city, state, postcode, country, shopify_customer_id, is_active)
     VALUES (?, 'retail_customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [businessId, customer.name, customer.firstName, customer.lastName, customer.email, customer.phone,
      customer.address, customer.address2, customer.city, customer.state, customer.postcode,
      customer.country ?? 'Australia', customer.id],
  );
  return Number(result.insertId);
}

export async function getOrCreateOnlineCustomerId(businessId: string): Promise<number> {
  const configured = await imsQuery<{ id: number }>(
    `SELECT c.id
       FROM ims_settings s
       JOIN ims_contacts c ON c.id = CAST(s.value AS UNSIGNED) AND c.business_id = s.business_id
      WHERE s.business_id = ? AND s.\`key\` = 'online_sales_customer_id'
      LIMIT 1`,
    [businessId],
  );
  if (configured[0]) return Number(configured[0].id);

  const existing = await imsQuery<{ id: number }>(
    `SELECT id FROM ims_contacts
      WHERE business_id = ? AND name = 'Online Customer'
      ORDER BY id LIMIT 1`,
    [businessId],
  );
  let contactId = Number(existing[0]?.id ?? 0);
  if (!contactId) {
    const created = await imsExecute(
      `INSERT INTO ims_contacts (business_id, type, name, is_active)
       VALUES (?, 'retail_customer', 'Online Customer', 1)`,
      [businessId],
    );
    contactId = Number(created.insertId);
  }
  await imsExecute(
    `INSERT INTO ims_settings (business_id, \`key\`, value)
     VALUES (?, 'online_sales_customer_id', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [businessId, String(contactId)],
  );
  return contactId;
}