import { ONLINE_SHOP_FULFILMENT_MODES, type OnlineShopFulfilmentMode } from '@/lib/onlineShop/fulfilmentAllocation';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export const ONLINE_SHOP_FULFILMENT_MODE_KEY = 'native_shop_fulfilment_mode';
export const ONLINE_SHOP_DISPATCH_LOCATION_KEY = 'native_shop_dispatch_location_id';

export interface OnlineShopFulfilmentSettings {
  mode: OnlineShopFulfilmentMode;
  dispatchLocationId: number | null;
}

export interface OnlineShopFulfilmentLocation {
  id: number;
  name: string;
  priority: number;
}

function parsePriority(value: string | undefined): number[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isSafeInteger) : [];
  } catch {
    return [];
  }
}

export function parseOnlineShopFulfilmentSettings(values: Readonly<Record<string, string>>): OnlineShopFulfilmentSettings {
  const rawMode = values[ONLINE_SHOP_FULFILMENT_MODE_KEY];
  const mode = ONLINE_SHOP_FULFILMENT_MODES.includes(rawMode as OnlineShopFulfilmentMode)
    ? rawMode as OnlineShopFulfilmentMode : 'single_location';
  const rawLocationId = Number(values[ONLINE_SHOP_DISPATCH_LOCATION_KEY]);
  return { mode, dispatchLocationId: Number.isSafeInteger(rawLocationId) && rawLocationId > 0 ? rawLocationId : null };
}

export const OnlineShopFulfilmentSettingsRepository = {
  async get(businessId: string): Promise<OnlineShopFulfilmentSettings> {
    const rows = await imsQuery<{ key: string; value: string }>(
      'SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN (?, ?)',
      [businessId, ONLINE_SHOP_FULFILMENT_MODE_KEY, ONLINE_SHOP_DISPATCH_LOCATION_KEY],
    );
    return parseOnlineShopFulfilmentSettings(Object.fromEntries(rows.map(row => [row.key, row.value])));
  },

  async listLocations(businessId: string): Promise<OnlineShopFulfilmentLocation[]> {
    const [locations, settings] = await Promise.all([
      imsQuery<{ id: number; name: string }>(
        'SELECT id, name FROM ims_locations WHERE business_id = ? AND is_active = 1 AND has_online = 1 ORDER BY name, id',
        [businessId],
      ),
      imsQuery<{ value: string }>(
        "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'online_pick_priority' LIMIT 1",
        [businessId],
      ),
    ]);
    const priority = parsePriority(settings[0]?.value);
    const rank = new Map(priority.map((id, index) => [id, index]));
    return locations.map(location => ({ ...location, priority: rank.get(location.id) ?? priority.length + location.id }))
      .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
  },

  async save(businessId: string, input: { mode: unknown; dispatchLocationId?: unknown }): Promise<void> {
    if (!ONLINE_SHOP_FULFILMENT_MODES.includes(input.mode as OnlineShopFulfilmentMode)) {
      throw new Error('Choose a valid online shop fulfilment mode.');
    }
    const mode = input.mode as OnlineShopFulfilmentMode;
    const dispatchLocationId = Number(input.dispatchLocationId);
    if (mode === 'consolidate' && (!Number.isSafeInteger(dispatchLocationId) || dispatchLocationId <= 0)) {
      throw new Error('Choose a dispatch location for consolidated orders.');
    }
    if (mode === 'consolidate') {
      const rows = await imsQuery<{ id: number }>(
        'SELECT id FROM ims_locations WHERE business_id = ? AND id = ? AND is_active = 1 AND has_online = 1 LIMIT 1',
        [businessId, dispatchLocationId],
      );
      if (!rows[0]) throw new Error('The dispatch location must be an active online location.');
    }
    await imsExecute(
      `INSERT INTO ims_settings (business_id, \`key\`, value) VALUES (?, ?, ?), (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [businessId, ONLINE_SHOP_FULFILMENT_MODE_KEY, mode, businessId, ONLINE_SHOP_DISPATCH_LOCATION_KEY,
        mode === 'consolidate' ? String(dispatchLocationId) : ''],
    );
  },
};