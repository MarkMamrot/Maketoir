import { describe, expect, it } from 'vitest';
import { applyTaxSettingDefaults, buildTaxSettingsUpdate, TAX_SETTING_DEFAULTS } from '../taxSettings';

describe('IMS tax settings', () => {
  it('supplies Australian defaults when legacy settings are absent or blank', () => {
    const settings = { sales_tax_code: '', purchase_tax_rate: '   ' };

    applyTaxSettingDefaults(settings);

    expect(settings).toMatchObject(TAX_SETTING_DEFAULTS);
  });

  it('preserves configured tax values while accounting integration is off', () => {
    const settings = {
      connect_accounting_software: 'no',
      sales_tax_on_sales: 'no',
      sales_tax_rate: '0.15',
      sales_tax_code: 'Custom sales label',
      purchase_tax_rate: '0.125',
      purchase_tax_code: 'Custom purchase label',
    };

    applyTaxSettingDefaults(settings);

    expect(settings).toEqual({
      connect_accounting_software: 'no',
      sales_tax_on_sales: 'no',
      sales_tax_rate: '0.15',
      sales_tax_code: 'Custom sales label',
      purchase_tax_rate: '0.125',
      purchase_tax_code: 'Custom purchase label',
    });
  });

  it('builds a complete persisted tax block when another General setting changes', () => {
    expect(buildTaxSettingsUpdate({ sales_tax_rate: '0.15', sales_tax_code: ' GST Sales ' })).toEqual({
      sales_tax_on_sales: 'yes',
      sales_tax_rate: '0.15',
      sales_tax_code: 'GST Sales',
      purchase_tax_rate: '0.1',
      purchase_tax_code: 'GST on Purchases',
    });
  });
});