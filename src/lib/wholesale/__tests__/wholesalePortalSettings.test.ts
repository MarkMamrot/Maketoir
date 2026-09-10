import { describe, expect, it } from 'vitest';
import {
  applyWholesalePortalSettingDefaults,
  isWholesalePreviewMutationAllowed,
  parseWholesalePortalSettings,
  validateWholesalePortalSetting,
  WHOLESALE_PORTAL_SETTING_KEYS,
} from '../wholesalePortalSettings';

describe('wholesale portal settings', () => {
  it('uses safe defaults for missing or invalid persisted values', () => {
    expect(parseWholesalePortalSettings({
      wholesale_staff_preview_mode: 'full_access',
      wholesale_product_image_fit: 'stretch',
    })).toEqual({ staffPreviewMode: 'read_only', productImageFit: 'cover', productImageRatio: 'landscape', orderQuantityMode: 'individual', catalogueOrderView: 'quick_order', productCardDisplay: 'details', hideProductsWithoutPhotos: false, hideProductsWithoutStock: false });
  });

  it('parses every supported setting', () => {
    expect(parseWholesalePortalSettings({
      wholesale_staff_preview_mode: 'ims_draft_test',
      wholesale_product_image_fit: 'contain',
      wholesale_product_image_ratio: 'portrait',
      wholesale_order_quantity_mode: 'pack',
      wholesale_catalogue_order_view: 'storefront',
      wholesale_product_card_display: 'image_overlay',
      wholesale_hide_products_without_photos: 'yes',
      wholesale_hide_products_without_stock: 'yes',
    })).toEqual({ staffPreviewMode: 'ims_draft_test', productImageFit: 'contain', productImageRatio: 'portrait', orderQuantityMode: 'pack', catalogueOrderView: 'storefront', productCardDisplay: 'image_overlay', hideProductsWithoutPhotos: true, hideProductsWithoutStock: true });
  });

  it('validates only known values and leaves unrelated settings alone', () => {
    expect(validateWholesalePortalSetting(WHOLESALE_PORTAL_SETTING_KEYS.productImageRatio, 'square')).toBe('square');
    expect(validateWholesalePortalSetting(WHOLESALE_PORTAL_SETTING_KEYS.productImageRatio, 'wide')).toBe('');
    expect(validateWholesalePortalSetting('business_name', 'Example')).toBeNull();
  });

  it('adds storage-shaped defaults', () => {
    const settings: Record<string, string> = {};
    applyWholesalePortalSettingDefaults(settings);
    expect(settings).toMatchObject({
      wholesale_staff_preview_mode: 'read_only',
      wholesale_product_image_fit: 'cover',
      wholesale_product_image_ratio: 'landscape',
      wholesale_order_quantity_mode: 'individual',
      wholesale_catalogue_order_view: 'quick_order',
      wholesale_product_card_display: 'details',
      wholesale_hide_products_without_photos: 'no',
      wholesale_hide_products_without_stock: 'no',
    });
  });

  it('allows only test-mode commerce mutations', () => {
    expect(isWholesalePreviewMutationAllowed('ims_draft_test', 'POST', '/api/wholesale/orders')).toBe(true);
    expect(isWholesalePreviewMutationAllowed('ims_draft_test', 'POST', '/api/wholesale/orders/8/submit')).toBe(true);
    expect(isWholesalePreviewMutationAllowed('ims_draft_test', 'PUT', '/api/wholesale/account')).toBe(false);
    expect(isWholesalePreviewMutationAllowed('read_only', 'POST', '/api/wholesale/orders')).toBe(false);
  });
});