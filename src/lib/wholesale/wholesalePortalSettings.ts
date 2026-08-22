export const WHOLESALE_PORTAL_SETTING_KEYS = {
  staffPreviewMode: 'wholesale_staff_preview_mode',
  productImageFit: 'wholesale_product_image_fit',
  productImageRatio: 'wholesale_product_image_ratio',
  orderQuantityMode: 'wholesale_order_quantity_mode',
  catalogueOrderView: 'wholesale_catalogue_order_view',
} as const;

export type WholesaleStaffPreviewMode = 'read_only' | 'ims_draft_test';
export type WholesaleProductImageFit = 'cover' | 'contain';
export type WholesaleProductImageRatio = 'landscape' | 'square' | 'portrait';
export type WholesaleOrderQuantityMode = 'individual' | 'pack';
export type WholesaleCatalogueOrderView = 'quick_order' | 'storefront';

export interface WholesalePortalSettings {
  staffPreviewMode: WholesaleStaffPreviewMode;
  productImageFit: WholesaleProductImageFit;
  productImageRatio: WholesaleProductImageRatio;
  orderQuantityMode: WholesaleOrderQuantityMode;
  catalogueOrderView: WholesaleCatalogueOrderView;
}

export const DEFAULT_WHOLESALE_PORTAL_SETTINGS: WholesalePortalSettings = {
  staffPreviewMode: 'read_only',
  productImageFit: 'cover',
  productImageRatio: 'landscape',
  orderQuantityMode: 'individual',
  catalogueOrderView: 'quick_order',
};

const VALID_VALUES: Record<string, readonly string[]> = {
  [WHOLESALE_PORTAL_SETTING_KEYS.staffPreviewMode]: ['read_only', 'ims_draft_test'],
  [WHOLESALE_PORTAL_SETTING_KEYS.productImageFit]: ['cover', 'contain'],
  [WHOLESALE_PORTAL_SETTING_KEYS.productImageRatio]: ['landscape', 'square', 'portrait'],
  [WHOLESALE_PORTAL_SETTING_KEYS.orderQuantityMode]: ['individual', 'pack'],
  [WHOLESALE_PORTAL_SETTING_KEYS.catalogueOrderView]: ['quick_order', 'storefront'],
};

export function validateWholesalePortalSetting(key: string, rawValue: unknown): string | null {
  const allowed = VALID_VALUES[key];
  if (!allowed) return null;
  const value = String(rawValue ?? '').trim().toLowerCase();
  return allowed.includes(value) ? value : '';
}

export function parseWholesalePortalSettings(settings: Record<string, unknown>): WholesalePortalSettings {
  const previewMode = validateWholesalePortalSetting(
    WHOLESALE_PORTAL_SETTING_KEYS.staffPreviewMode,
    settings[WHOLESALE_PORTAL_SETTING_KEYS.staffPreviewMode],
  );
  const imageFit = validateWholesalePortalSetting(
    WHOLESALE_PORTAL_SETTING_KEYS.productImageFit,
    settings[WHOLESALE_PORTAL_SETTING_KEYS.productImageFit],
  );
  const imageRatio = validateWholesalePortalSetting(
    WHOLESALE_PORTAL_SETTING_KEYS.productImageRatio,
    settings[WHOLESALE_PORTAL_SETTING_KEYS.productImageRatio],
  );
  const orderQuantityMode = validateWholesalePortalSetting(
    WHOLESALE_PORTAL_SETTING_KEYS.orderQuantityMode,
    settings[WHOLESALE_PORTAL_SETTING_KEYS.orderQuantityMode],
  );
  const catalogueOrderView = validateWholesalePortalSetting(
    WHOLESALE_PORTAL_SETTING_KEYS.catalogueOrderView,
    settings[WHOLESALE_PORTAL_SETTING_KEYS.catalogueOrderView],
  );

  return {
    staffPreviewMode: previewMode as WholesaleStaffPreviewMode || DEFAULT_WHOLESALE_PORTAL_SETTINGS.staffPreviewMode,
    productImageFit: imageFit as WholesaleProductImageFit || DEFAULT_WHOLESALE_PORTAL_SETTINGS.productImageFit,
    productImageRatio: imageRatio as WholesaleProductImageRatio || DEFAULT_WHOLESALE_PORTAL_SETTINGS.productImageRatio,
    orderQuantityMode: orderQuantityMode as WholesaleOrderQuantityMode || DEFAULT_WHOLESALE_PORTAL_SETTINGS.orderQuantityMode,
    catalogueOrderView: catalogueOrderView as WholesaleCatalogueOrderView || DEFAULT_WHOLESALE_PORTAL_SETTINGS.catalogueOrderView,
  };
}

export function applyWholesalePortalSettingDefaults(settings: Record<string, string>): void {
  settings[WHOLESALE_PORTAL_SETTING_KEYS.staffPreviewMode] ||= DEFAULT_WHOLESALE_PORTAL_SETTINGS.staffPreviewMode;
  settings[WHOLESALE_PORTAL_SETTING_KEYS.productImageFit] ||= DEFAULT_WHOLESALE_PORTAL_SETTINGS.productImageFit;
  settings[WHOLESALE_PORTAL_SETTING_KEYS.productImageRatio] ||= DEFAULT_WHOLESALE_PORTAL_SETTINGS.productImageRatio;
  settings[WHOLESALE_PORTAL_SETTING_KEYS.orderQuantityMode] ||= DEFAULT_WHOLESALE_PORTAL_SETTINGS.orderQuantityMode;
  settings[WHOLESALE_PORTAL_SETTING_KEYS.catalogueOrderView] ||= DEFAULT_WHOLESALE_PORTAL_SETTINGS.catalogueOrderView;
}

export function isWholesalePreviewMutationAllowed(mode: WholesaleStaffPreviewMode, method: string, pathname: string): boolean {
  if (mode !== 'ims_draft_test') return false;
  if (method === 'POST' && pathname === '/api/wholesale/account/location') return true;
  if (method === 'POST' && pathname === '/api/wholesale/orders') return true;
  if (['PUT', 'DELETE'].includes(method) && /^\/api\/wholesale\/orders\/\d+$/.test(pathname)) return true;
  return method === 'POST' && /^\/api\/wholesale\/orders\/\d+\/submit$/.test(pathname);
}