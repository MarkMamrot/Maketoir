import type {
  StorefrontLayoutDocument,
  StorefrontLayoutSection,
  StorefrontLayoutSectionDefinition,
  StorefrontLayoutSectionSettings,
} from '@/lib/storefront/layout';

export const ONLINE_SHOP_LAYOUT_SCHEMA_VERSION = 1 as const;
export const ONLINE_SHOP_LAYOUT_PAGE_IDS = ['home', 'catalogue', 'collection', 'product', 'cart', 'checkout', 'login', 'account'] as const;
export type OnlineShopLayoutPageId = typeof ONLINE_SHOP_LAYOUT_PAGE_IDS[number];

export const ONLINE_SHOP_SHARED_SECTION_TYPES = ['banner', 'rich_text', 'image', 'text_image', 'divider', 'spacer', 'featured_products'] as const;
export type OnlineShopSharedSectionType = typeof ONLINE_SHOP_SHARED_SECTION_TYPES[number];

export const ONLINE_SHOP_SYSTEM_SECTION_TYPES = [
  'shop_home', 'shop_catalogue', 'shop_collection', 'shop_product_media', 'shop_product_purchase',
  'shop_cart', 'shop_checkout', 'shop_login', 'shop_account',
] as const;
export type OnlineShopSystemSectionType = typeof ONLINE_SHOP_SYSTEM_SECTION_TYPES[number];
export type OnlineShopLayoutSectionType = OnlineShopSystemSectionType | OnlineShopSharedSectionType;

export type OnlineShopLayoutSection = StorefrontLayoutSection<OnlineShopLayoutSectionType>;
export type OnlineShopLayoutDocument = StorefrontLayoutDocument<
  OnlineShopLayoutPageId,
  OnlineShopLayoutSectionType,
  typeof ONLINE_SHOP_LAYOUT_SCHEMA_VERSION
>;
export type OnlineShopLayoutSectionDefinition = StorefrontLayoutSectionDefinition<OnlineShopLayoutPageId, OnlineShopLayoutSectionType>;

export const ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION = 1 as const;
export type OnlineShopContentPageSection = StorefrontLayoutSection<OnlineShopSharedSectionType>;
export interface OnlineShopContentPageDocument {
  schemaVersion: typeof ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION;
  sections: OnlineShopContentPageSection[];
}

export type OnlineShopSectionSettings = StorefrontLayoutSectionSettings;