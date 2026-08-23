import type { OnlineShopLayoutPageId, OnlineShopLayoutSectionDefinition, OnlineShopLayoutSectionType } from './types';

const allPages: readonly OnlineShopLayoutPageId[] = ['home', 'catalogue', 'collection', 'product', 'cart', 'checkout', 'login', 'account'];
const contentDefaults = { width: 'content' as const, alignment: 'left' as const, spacingTop: 'medium' as const, spacingBottom: 'medium' as const };

function system(type: OnlineShopLayoutSectionType, label: string, page: OnlineShopLayoutPageId): OnlineShopLayoutSectionDefinition {
  return { type, label, allowedPages: [page], requiredOn: [page], singleton: true, defaultSettings: {} };
}

export const ONLINE_SHOP_LAYOUT_SECTION_REGISTRY: Record<OnlineShopLayoutSectionType, OnlineShopLayoutSectionDefinition> = {
  shop_home: system('shop_home', 'Shop home', 'home'),
  shop_catalogue: system('shop_catalogue', 'Product catalogue', 'catalogue'),
  shop_collection: system('shop_collection', 'Collection products', 'collection'),
  shop_product_media: system('shop_product_media', 'Images and description', 'product'),
  shop_product_purchase: system('shop_product_purchase', 'Product options and quantity', 'product'),
  shop_cart: system('shop_cart', 'Shopping cart', 'cart'),
  shop_checkout: system('shop_checkout', 'Secure checkout', 'checkout'),
  shop_login: system('shop_login', 'Customer sign in', 'login'),
  shop_account: system('shop_account', 'Customer account', 'account'),
  banner: { type: 'banner', label: 'Banner', allowedPages: allPages, defaultSettings: { ...contentDefaults, alignment: 'center', heading: 'Banner heading', bodyHtml: '<p>Add supporting text.</p>' } },
  rich_text: { type: 'rich_text', label: 'Rich text', allowedPages: allPages, defaultSettings: { ...contentDefaults, heading: 'Heading', bodyHtml: '<p>Add your content.</p>' } },
  image: { type: 'image', label: 'Image', allowedPages: allPages, defaultSettings: { ...contentDefaults, imageFit: 'cover', imageRatio: 'landscape', altText: '' } },
  text_image: { type: 'text_image', label: 'Text and image', allowedPages: allPages, defaultSettings: { ...contentDefaults, heading: 'Heading', bodyHtml: '<p>Add your content.</p>', imageFit: 'cover', imageRatio: 'landscape', imageSide: 'right', altText: '' } },
  divider: { type: 'divider', label: 'Divider', allowedPages: allPages, defaultSettings: { width: 'content', spacingTop: 'small', spacingBottom: 'small' } },
  spacer: { type: 'spacer', label: 'Spacer', allowedPages: allPages, defaultSettings: { spacingTop: 'medium', spacingBottom: 'medium' } },
  featured_products: { type: 'featured_products', label: 'Featured products', allowedPages: allPages, defaultSettings: { ...contentDefaults, heading: 'Featured products', productIds: [], productLimit: 4 } },
};

export function getOnlineShopLayoutSectionDefinition(type: string): OnlineShopLayoutSectionDefinition | null {
  return ONLINE_SHOP_LAYOUT_SECTION_REGISTRY[type as OnlineShopLayoutSectionType] ?? null;
}