export const PRODUCT_SETTING_KEYS = {
  showProductType: 'product_show_product_type',
  showTags: 'product_show_tags',
  showWholesalePrice: 'product_show_wholesale_price',
  showWeight: 'product_show_weight',
  allowOpeningStock: 'product_allow_opening_stock',
} as const;

const PRODUCT_SETTING_DEFAULTS: Record<string, 'yes' | 'no'> = {
  [PRODUCT_SETTING_KEYS.showProductType]: 'yes',
  [PRODUCT_SETTING_KEYS.showTags]: 'yes',
  [PRODUCT_SETTING_KEYS.showWholesalePrice]: 'yes',
  [PRODUCT_SETTING_KEYS.showWeight]: 'yes',
  [PRODUCT_SETTING_KEYS.allowOpeningStock]: 'no',
};

export interface ProductSettings {
  showCategories: boolean;
  showProductType: boolean;
  showTags: boolean;
  showWholesalePrice: boolean;
  showWeight: boolean;
  allowOpeningStock: boolean;
}

export function applyProductSettingDefaults(settings: Record<string, string>): void {
  for (const [key, value] of Object.entries(PRODUCT_SETTING_DEFAULTS)) settings[key] ??= value;
}

export function parseProductSettings(settings: Record<string, string>): ProductSettings {
  return {
    showCategories: settings.use_categories === 'yes',
    showProductType: (settings[PRODUCT_SETTING_KEYS.showProductType] ?? 'yes') === 'yes',
    showTags: (settings[PRODUCT_SETTING_KEYS.showTags] ?? 'yes') === 'yes',
    showWholesalePrice: (settings[PRODUCT_SETTING_KEYS.showWholesalePrice] ?? 'yes') === 'yes',
    showWeight: (settings[PRODUCT_SETTING_KEYS.showWeight] ?? 'yes') === 'yes',
    allowOpeningStock: (settings[PRODUCT_SETTING_KEYS.allowOpeningStock] ?? 'no') === 'yes',
  };
}

export function validateProductSetting(key: string, rawValue: unknown): { value: 'yes' | 'no' } | { error: string } | null {
  if (key !== 'use_categories' && !(key in PRODUCT_SETTING_DEFAULTS)) return null;
  const value = String(rawValue);
  if (value !== 'yes' && value !== 'no') return { error: 'Product feature settings must be yes or no.' };
  return { value };
}