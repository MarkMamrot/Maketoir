import { describe, expect, it } from 'vitest';
import {
  applyProductSettingDefaults,
  parseProductSettings,
  PRODUCT_SETTING_KEYS,
  validateProductSetting,
} from '../productSettings';

describe('product settings', () => {
  it('preserves the category fallback while showing newly configurable fields by default', () => {
    const settings: Record<string, string> = {};
    applyProductSettingDefaults(settings);

    expect(parseProductSettings(settings)).toEqual({
      showCategories: false,
      showProductType: true,
      showTags: true,
      showWholesalePrice: true,
      showWeight: true,
      allowOpeningStock: true,
    });
  });

  it('preserves explicit tenant choices', () => {
    const settings = {
      use_categories: 'yes',
      [PRODUCT_SETTING_KEYS.showTags]: 'no',
    };
    applyProductSettingDefaults(settings);

    expect(parseProductSettings(settings).showCategories).toBe(true);
    expect(parseProductSettings(settings).showTags).toBe(false);
  });

  it('accepts only yes or no for product feature settings', () => {
    expect(validateProductSetting(PRODUCT_SETTING_KEYS.showWeight, 'no')).toEqual({ value: 'no' });
    expect(validateProductSetting(PRODUCT_SETTING_KEYS.showWeight, 'true')).toEqual({ error: 'Product feature settings must be yes or no.' });
    expect(validateProductSetting('unrelated_setting', 'anything')).toBeNull();
  });
});