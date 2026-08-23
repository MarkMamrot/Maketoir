import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { normalizeAustralianShippingAddress, quoteOnlineShopShipping, type OnlineShopShippingQuote, type OnlineShopShippingRule } from '@/lib/onlineShop/shippingRules';
import type { StorefrontShippingAddress } from '@/lib/storefront/shipping';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

interface ShippingRuleRow {
  id: number;
  name: string;
  rule_type: string;
  amount_cents: number | string;
  free_over_cents: number | string | null;
  states_json: unknown;
  postcodes_json: unknown;
  sort_order: number;
  is_active: number;
}

export interface OnlineShopPickupOption {
  locationId: number;
  label: string;
  instructions: string | null;
  sortOrder: number;
  isActive: boolean;
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  if (typeof value !== 'string' || !value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String).map(item => item.trim()).filter(Boolean) : []; }
  catch { return []; }
}

function mapRule(row: ShippingRuleRow): OnlineShopShippingRule {
  return { id: Number(row.id), name: row.name, ruleType: 'flat', amountCents: Number(row.amount_cents) || 0,
    freeOverCents: row.free_over_cents === null ? null : Number(row.free_over_cents), states: parseList(row.states_json).map(state => state.toUpperCase()),
    postcodes: parseList(row.postcodes_json), sortOrder: Number(row.sort_order) || 0 };
}

async function listRules(businessId: string, activeOnly: boolean): Promise<Array<OnlineShopShippingRule & { isActive: boolean }>> {
  const rows = await imsQuery<ShippingRuleRow>(
    `SELECT id, name, rule_type, amount_cents, free_over_cents, states_json, postcodes_json, sort_order, is_active
       FROM ims_online_shop_shipping_rules WHERE business_id = ? ${activeOnly ? 'AND is_active = 1' : ''}
      ORDER BY sort_order, id`, [businessId],
  );
  return rows.filter(row => row.rule_type === 'flat').map(row => ({ ...mapRule(row), isActive: row.is_active === 1 }));
}

export const OnlineShopShippingRepository = {
  async listRules(businessId: string, activeOnly = false) {
    return runImsForBusiness(businessId, () => listRules(businessId, activeOnly));
  },

  async listPickupOptions(businessId: string, activeOnly = true): Promise<OnlineShopPickupOption[]> {
    return runImsForBusiness(businessId, async () => {
      const rows = await imsQuery<{ location_id: number; label: string; instructions: string | null; sort_order: number; is_active: number }>(
        `SELECT p.location_id, COALESCE(NULLIF(p.display_name, ''), l.name) AS label, p.instructions, p.sort_order, p.is_active
           FROM ims_online_shop_pickup_locations p
           JOIN ims_locations l ON l.id = p.location_id AND l.business_id = p.business_id AND l.is_active = 1 AND l.has_online = 1
          WHERE p.business_id = ? ${activeOnly ? 'AND p.is_active = 1' : ''} ORDER BY p.sort_order, label, p.location_id`, [businessId],
      );
      return rows.map(row => ({ locationId: Number(row.location_id), label: row.label, instructions: row.instructions,
        sortOrder: Number(row.sort_order) || 0, isActive: row.is_active === 1 }));
    });
  },

  async quoteDelivery(businessId: string, rawAddress: unknown, subtotalCents: number): Promise<{ address: StorefrontShippingAddress; options: OnlineShopShippingQuote[] }> {
    const address = normalizeAustralianShippingAddress(rawAddress);
    const rules = await this.listRules(businessId, true);
    return { address, options: quoteOnlineShopShipping({ address, subtotalCents, rules }) };
  },

  async saveRule(businessId: string, input: { id?: unknown; name: unknown; amountCents: unknown; freeOverCents?: unknown;
    states?: unknown; postcodes?: unknown; sortOrder?: unknown; isActive?: unknown }): Promise<number> {
    const id = Number(input.id);
    const name = String(input.name ?? '').trim();
    const amountCents = Number(input.amountCents);
    const freeOverCents = input.freeOverCents === '' || input.freeOverCents == null ? null : Number(input.freeOverCents);
    const states = parseList(input.states).map(state => state.toUpperCase());
    const postcodes = parseList(input.postcodes);
    const sortOrder = Number(input.sortOrder) || 0;
    if (!name || name.length > 120) throw new Error('Shipping rule name is required.');
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error('Shipping amount must be valid cents.');
    if (freeOverCents !== null && (!Number.isSafeInteger(freeOverCents) || freeOverCents <= 0)) throw new Error('Free shipping threshold must be valid cents.');
    if (states.some(state => !['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].includes(state))) throw new Error('Shipping rule contains an invalid state.');
    if (postcodes.some(pattern => !/^(?:\d{4}|\d{1,3}\*|\d{4}-\d{4})$/.test(pattern))) throw new Error('Postcodes must be exact, ranges, or prefixes such as 2*.');
    if (Number.isSafeInteger(id) && id > 0) {
      const result = await imsExecute(
        `UPDATE ims_online_shop_shipping_rules SET name = ?, amount_cents = ?, free_over_cents = ?, states_json = ?, postcodes_json = ?,
           sort_order = ?, is_active = ? WHERE business_id = ? AND id = ?`,
        [name, amountCents, freeOverCents, JSON.stringify(states), JSON.stringify(postcodes), sortOrder, input.isActive === false ? 0 : 1, businessId, id],
      );
      if (!result.affectedRows) throw new Error('Shipping rule was not found.');
      return id;
    }
    const result = await imsExecute(
      `INSERT INTO ims_online_shop_shipping_rules
         (business_id, name, rule_type, amount_cents, free_over_cents, states_json, postcodes_json, sort_order, is_active)
       VALUES (?, ?, 'flat', ?, ?, ?, ?, ?, ?)`,
      [businessId, name, amountCents, freeOverCents, JSON.stringify(states), JSON.stringify(postcodes), sortOrder, input.isActive === false ? 0 : 1],
    );
    return Number(result.insertId);
  },

  async deleteRule(businessId: string, id: number): Promise<void> {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Shipping rule ID is required.');
    await imsExecute('DELETE FROM ims_online_shop_shipping_rules WHERE business_id = ? AND id = ?', [businessId, id]);
  },

  async savePickup(businessId: string, input: { locationId: unknown; displayName?: unknown; instructions?: unknown; sortOrder?: unknown; isActive?: unknown }): Promise<void> {
    const locationId = Number(input.locationId);
    if (!Number.isSafeInteger(locationId) || locationId <= 0) throw new Error('Pickup location is required.');
    const locations = await imsQuery<{ id: number }>('SELECT id FROM ims_locations WHERE business_id = ? AND id = ? AND is_active = 1 AND has_online = 1 LIMIT 1', [businessId, locationId]);
    if (!locations[0]) throw new Error('Pickup location must be an active online location.');
    await imsExecute(
      `INSERT INTO ims_online_shop_pickup_locations
         (business_id, location_id, display_name, instructions, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), instructions = VALUES(instructions),
         sort_order = VALUES(sort_order), is_active = VALUES(is_active)`,
      [businessId, locationId, String(input.displayName ?? '').trim().slice(0, 255) || null,
        String(input.instructions ?? '').trim().slice(0, 1000) || null, Number(input.sortOrder) || 0, input.isActive === false ? 0 : 1],
    );
  },
};