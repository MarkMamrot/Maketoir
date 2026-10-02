import { execute, query } from '@/services/MySQLService';
import {
  DEFAULT_KLAVIYO_INTEGRATION_SETTINGS,
  type KlaviyoIntegrationSettings,
} from './contracts';

interface KlaviyoSettingsRow {
  enabled: number;
  profiles_enabled: number;
  reporting_enabled: number;
  pos_enabled: number;
  native_shop_enabled: number;
  wholesale_enabled: number;
  shopify_enabled: number;
  shopify_duplicate_risk_acknowledged: number;
}

function fromRow(row: KlaviyoSettingsRow): KlaviyoIntegrationSettings {
  return {
    enabled: row.enabled === 1,
    profilesEnabled: row.profiles_enabled === 1,
    reportingEnabled: row.reporting_enabled === 1,
    sources: {
      pos: row.pos_enabled === 1,
      nativeShop: row.native_shop_enabled === 1,
      wholesale: row.wholesale_enabled === 1,
      shopify: row.shopify_enabled === 1,
    },
    shopifyDuplicateRiskAcknowledged: row.shopify_duplicate_risk_acknowledged === 1,
  };
}

export const KlaviyoSettingsRepository = {
  async get(businessId: string): Promise<KlaviyoIntegrationSettings> {
    const rows = await query<KlaviyoSettingsRow>(
      `SELECT enabled, profiles_enabled, reporting_enabled,
              pos_enabled, native_shop_enabled, wholesale_enabled, shopify_enabled,
              shopify_duplicate_risk_acknowledged
         FROM klaviyo_integration_settings
        WHERE business_id = ?`,
      [businessId],
    );
    return rows[0] ? fromRow(rows[0]) : DEFAULT_KLAVIYO_INTEGRATION_SETTINGS;
  },

  async save(businessId: string, settings: KlaviyoIntegrationSettings): Promise<void> {
    if (settings.sources.shopify && !settings.shopifyDuplicateRiskAcknowledged) {
      throw new Error('Shopify Klaviyo events require acknowledgement of duplicate-event risk.');
    }
    await execute(
      `INSERT INTO klaviyo_integration_settings
         (business_id, enabled, profiles_enabled, reporting_enabled,
          pos_enabled, native_shop_enabled, wholesale_enabled, shopify_enabled,
          shopify_duplicate_risk_acknowledged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         profiles_enabled = VALUES(profiles_enabled),
         reporting_enabled = VALUES(reporting_enabled),
         pos_enabled = VALUES(pos_enabled),
         native_shop_enabled = VALUES(native_shop_enabled),
         wholesale_enabled = VALUES(wholesale_enabled),
         shopify_enabled = VALUES(shopify_enabled),
         shopify_duplicate_risk_acknowledged = VALUES(shopify_duplicate_risk_acknowledged),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [
        businessId,
        settings.enabled ? 1 : 0,
        settings.profilesEnabled ? 1 : 0,
        settings.reportingEnabled ? 1 : 0,
        settings.sources.pos ? 1 : 0,
        settings.sources.nativeShop ? 1 : 0,
        settings.sources.wholesale ? 1 : 0,
        settings.sources.shopify ? 1 : 0,
        settings.shopifyDuplicateRiskAcknowledged ? 1 : 0,
      ],
    );
  },
};