export const TAX_SETTING_DEFAULTS = {
  sales_tax_on_sales: 'yes',
  sales_tax_rate: '0.1',
  sales_tax_code: 'GST',
  purchase_tax_rate: '0.1',
  purchase_tax_code: 'GST on Purchases',
} as const;

export const TAX_SETTING_KEYS = Object.keys(TAX_SETTING_DEFAULTS) as Array<keyof typeof TAX_SETTING_DEFAULTS>;

export function applyTaxSettingDefaults(settings: Record<string, string>): void {
  for (const [key, value] of Object.entries(TAX_SETTING_DEFAULTS)) {
    if (!settings[key]?.trim()) settings[key] = value;
  }
}

export function buildTaxSettingsUpdate(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(TAX_SETTING_KEYS.map(key => [key, settings[key]?.trim() || TAX_SETTING_DEFAULTS[key]]));
}