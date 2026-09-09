import { decrypt, encrypt } from '@/lib/encryption';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import type { CarrierAccountInput, PackagePresetInput } from './shippingSettings';
import type { AusPostPackagingPreset } from './ausPostPackagingCatalogue';

export type ShippingCarrierAccountSummary = {
  id: number;
  provider: string;
  displayName: string;
  accountNumber: string | null;
  dispatchLocationId: number | null;
  dispatchLocationName: string | null;
  dispatchAddressMissingFields: string[];
  merchantLocationId: string | null;
  credentialsConfigured: boolean;
  apiKeyLength: number;
  passwordLength: number;
  verifiedAt: string | null;
  verificationError: string | null;
  isActive: boolean;
};

export type ShippingPackagePreset = PackagePresetInput & { id: number };

type CarrierAccountRow = {
  id: number;
  provider: string;
  display_name: string;
  environment: string;
  base_url: string | null;
  account_number: string | null;
  dispatch_location_id: number | null;
  dispatch_location_name: string | null;
  dispatch_address: string | null;
  dispatch_city: string | null;
  dispatch_state: string | null;
  dispatch_postcode: string | null;
  merchant_location_id: string | null;
  api_key_encrypted: string | null;
  password_encrypted: string | null;
  verified_at: string | null;
  verification_error: string | null;
  is_active: number;
};

export const ShippingSettingsRepository = {
  async listAccounts(businessId: string): Promise<ShippingCarrierAccountSummary[]> {
    const rows = await imsQuery<CarrierAccountRow>(
      `SELECT account.id, account.provider, account.display_name, account.account_number,
              account.dispatch_location_id, location.name AS dispatch_location_name, account.merchant_location_id,
              location.address AS dispatch_address, location.city AS dispatch_city,
              location.state AS dispatch_state, location.postcode AS dispatch_postcode,
              account.api_key_encrypted, account.password_encrypted, account.verified_at,
              account.verification_error, account.is_active
         FROM ims_shipping_carrier_accounts account
         LEFT JOIN ims_locations location ON location.id = account.dispatch_location_id
        WHERE account.business_id = ?
        ORDER BY account.is_active DESC, account.display_name, account.id`,
      [businessId],
    );
    return rows.map(row => ({
      id: Number(row.id),
      provider: row.provider,
      displayName: row.display_name,
      accountNumber: row.account_number,
      dispatchLocationId: row.dispatch_location_id == null ? null : Number(row.dispatch_location_id),
      dispatchLocationName: row.dispatch_location_name,
      dispatchAddressMissingFields: [
        !row.dispatch_address?.trim() ? 'street address' : '',
        !row.dispatch_city?.trim() ? 'suburb/city' : '',
        !row.dispatch_state?.trim() ? 'state' : '',
        !row.dispatch_postcode?.trim() ? 'postcode' : '',
      ].filter(Boolean),
      merchantLocationId: row.merchant_location_id,
      credentialsConfigured: Boolean(row.api_key_encrypted && row.password_encrypted),
      apiKeyLength: row.api_key_encrypted ? decrypt(row.api_key_encrypted).length : 0,
      passwordLength: row.password_encrypted ? decrypt(row.password_encrypted).length : 0,
      verifiedAt: row.verified_at,
      verificationError: row.verification_error,
      isActive: Boolean(row.is_active),
    }));
  },

  async hasStoredCredentials(businessId: string, id: number): Promise<boolean> {
    const rows = await imsQuery<{ configured: number }>(
      `SELECT (api_key_encrypted IS NOT NULL AND api_key_encrypted <> ''
               AND password_encrypted IS NOT NULL AND password_encrypted <> '') AS configured
         FROM ims_shipping_carrier_accounts WHERE business_id = ? AND id = ? LIMIT 1`,
      [businessId, id],
    );
    return Boolean(rows[0]?.configured);
  },

  async getAccountCredentials(businessId: string, id: number): Promise<{
    provider: string; accountNumber: string; apiKey: string; password: string;
  } | null> {
    const rows = await imsQuery<CarrierAccountRow>(
      `SELECT id, provider, environment, base_url, account_number, api_key_encrypted, password_encrypted
         FROM ims_shipping_carrier_accounts WHERE business_id = ? AND id = ? AND is_active = 1 LIMIT 1`,
      [businessId, id],
    );
    const row = rows[0];
    if (!row?.account_number || !row.api_key_encrypted || !row.password_encrypted) return null;
    return {
      provider: row.provider,
      accountNumber: row.account_number,
      apiKey: decrypt(row.api_key_encrypted),
      password: decrypt(row.password_encrypted),
    };
  },

  async recordVerification(
    businessId: string,
    id: number,
    result: { merchantLocationId?: string | null; capabilities?: unknown; error?: string | null },
  ): Promise<void> {
    await imsExecute(
      `UPDATE ims_shipping_carrier_accounts
          SET merchant_location_id = ?, capabilities_json = ?, verified_at = ?, verification_error = ?
        WHERE business_id = ? AND id = ?`,
      [result.merchantLocationId ?? null, result.capabilities == null ? null : JSON.stringify(result.capabilities),
        result.error ? null : new Date(), result.error ?? null, businessId, id],
    );
  },

  async saveAccount(businessId: string, input: CarrierAccountInput): Promise<number> {
    const apiKey = input.apiKey?.trim() ? encrypt(input.apiKey.trim()) : null;
    const password = input.password?.trim() ? encrypt(input.password) : null;
    if (input.id) {
      const result = await imsExecute(
        `UPDATE ims_shipping_carrier_accounts
            SET provider = ?, display_name = ?, environment = 'production', base_url = NULL, account_number = ?,
                dispatch_location_id = ?, is_active = ?,
                api_key_encrypted = COALESCE(?, api_key_encrypted),
                password_encrypted = COALESCE(?, password_encrypted),
                verified_at = NULL, verification_error = NULL
          WHERE business_id = ? AND id = ?`,
        [input.provider, input.displayName.trim(), input.accountNumber?.trim() || null,
          input.dispatchLocationId ?? null, input.isActive === false ? 0 : 1, apiKey, password, businessId, input.id],
      );
      if (result.affectedRows === 0) throw new Error('Carrier account not found.');
      return input.id;
    }
    const result = await imsExecute(
      `INSERT INTO ims_shipping_carrier_accounts
        (business_id, provider, display_name, environment, base_url, account_number, api_key_encrypted,
          password_encrypted, dispatch_location_id, is_active)
      VALUES (?, ?, ?, 'production', NULL, ?, ?, ?, ?, ?)`,
          [businessId, input.provider, input.displayName.trim(), input.accountNumber?.trim() || null,
        apiKey, password, input.dispatchLocationId ?? null, input.isActive === false ? 0 : 1],
    );
    return Number(result.insertId);
  },

  async deactivateAccount(businessId: string, id: number): Promise<void> {
    const result = await imsExecute(
      'UPDATE ims_shipping_carrier_accounts SET is_active = 0 WHERE business_id = ? AND id = ?',
      [businessId, id],
    );
    if (result.affectedRows === 0) throw new Error('Carrier account not found.');
  },

  async listPresets(businessId: string): Promise<ShippingPackagePreset[]> {
    const rows = await imsQuery<any>(
      `SELECT id, name, package_type, length_mm, width_mm, height_mm, tare_weight_kg,
              max_weight_kg, allow_rotation, sort_priority, is_active
         FROM ims_shipping_package_presets WHERE business_id = ?
        ORDER BY is_active DESC, sort_priority, name, id`,
      [businessId],
    );
    return rows.map(row => ({
      id: Number(row.id), name: row.name, packageType: row.package_type,
      lengthMm: Number(row.length_mm), widthMm: Number(row.width_mm), heightMm: Number(row.height_mm),
      tareWeightKg: Number(row.tare_weight_kg), maxWeightKg: row.max_weight_kg == null ? null : Number(row.max_weight_kg),
      allowRotation: Boolean(row.allow_rotation), sortPriority: Number(row.sort_priority), isActive: Boolean(row.is_active),
    }));
  },

  async savePreset(businessId: string, input: PackagePresetInput): Promise<number> {
    const params = [input.name.trim(), input.packageType, input.lengthMm, input.widthMm, input.heightMm,
      input.tareWeightKg, input.maxWeightKg ?? null, input.allowRotation ? 1 : 0,
      input.sortPriority ?? 0, input.isActive === false ? 0 : 1];
    if (input.id) {
      const result = await imsExecute(
        `UPDATE ims_shipping_package_presets
            SET name = ?, package_type = ?, length_mm = ?, width_mm = ?, height_mm = ?, tare_weight_kg = ?,
                max_weight_kg = ?, allow_rotation = ?, sort_priority = ?, is_active = ?
          WHERE business_id = ? AND id = ?`,
        [...params, businessId, input.id],
      );
      if (result.affectedRows === 0) throw new Error('Package preset not found.');
      return input.id;
    }
    const result = await imsExecute(
      `INSERT INTO ims_shipping_package_presets
         (business_id, name, package_type, length_mm, width_mm, height_mm, tare_weight_kg,
          max_weight_kg, allow_rotation, sort_priority, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [businessId, ...params],
    );
    return Number(result.insertId);
  },

  async importAusPostPresets(businessId: string, presets: readonly AusPostPackagingPreset[]): Promise<number> {
    let created = 0;
    for (const preset of presets) {
      const result = await imsExecute(
        `INSERT IGNORE INTO ims_shipping_package_presets
           (business_id, name, package_type, length_mm, width_mm, height_mm, tare_weight_kg,
            max_weight_kg, allow_rotation, sort_priority, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
        [businessId, preset.name, preset.packageType, preset.lengthMm, preset.widthMm, preset.heightMm,
          preset.tareWeightKg, preset.maxWeightKg, preset.allowRotation ? 1 : 0],
      );
      created += result.affectedRows;
    }
    return created;
  },

  async deactivatePreset(businessId: string, id: number): Promise<void> {
    const result = await imsExecute(
      'UPDATE ims_shipping_package_presets SET is_active = 0 WHERE business_id = ? AND id = ?',
      [businessId, id],
    );
    if (result.affectedRows === 0) throw new Error('Package preset not found.');
  },
};
