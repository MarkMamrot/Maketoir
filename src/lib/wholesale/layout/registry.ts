import type {
  WholesaleLayoutPageId,
  WholesaleLayoutSectionDefinition,
  WholesaleLayoutSectionSettings,
  WholesaleLayoutSectionType,
} from './types';

const allPages: readonly WholesaleLayoutPageId[] = ['login', 'home', 'catalogue', 'cart', 'collection', 'product'];
const authenticatedPages: readonly WholesaleLayoutPageId[] = ['home', 'catalogue', 'cart', 'collection', 'product'];
const contentDefaults: WholesaleLayoutSectionSettings = {
  width: 'content',
  alignment: 'left',
  spacingTop: 'medium',
  spacingBottom: 'medium',
};

function systemSection(
  type: WholesaleLayoutSectionType,
  label: string,
  page: WholesaleLayoutPageId,
  required = false,
): WholesaleLayoutSectionDefinition {
  return {
    type,
    label,
    allowedPages: [page],
    requiredOn: required ? [page] : undefined,
    singleton: true,
    defaultSettings: {},
  };
}

export const WHOLESALE_LAYOUT_SECTION_REGISTRY: Record<WholesaleLayoutSectionType, WholesaleLayoutSectionDefinition> = {
  login_access: systemSection('login_access', 'Login access', 'login', true),
  home_welcome: systemSection('home_welcome', 'Welcome', 'home'),
  home_metrics: systemSection('home_metrics', 'Buyer metrics', 'home'),
  home_workspace: systemSection('home_workspace', 'Order workspace', 'home'),
  catalogue_browser: systemSection('catalogue_browser', 'Product browser', 'catalogue', true),
  collection_browser: systemSection('collection_browser', 'Category products', 'collection', true),
  product_media_description: systemSection('product_media_description', 'Images and description', 'product', true),
  product_variants: systemSection('product_variants', 'Variant ordering', 'product', true),
  cart_workflow: systemSection('cart_workflow', 'Cart workflow', 'cart', true),
  banner: {
    type: 'banner', label: 'Banner', allowedPages: allPages,
    defaultSettings: { ...contentDefaults, alignment: 'center', heading: 'Banner heading', bodyHtml: '<p>Add supporting text.</p>' },
  },
  rich_text: {
    type: 'rich_text', label: 'Rich text', allowedPages: allPages,
    defaultSettings: { ...contentDefaults, heading: 'Heading', bodyHtml: '<p>Add your content.</p>' },
  },
  image: {
    type: 'image', label: 'Image', allowedPages: allPages,
    defaultSettings: { ...contentDefaults, imageFit: 'cover', imageRatio: 'landscape', altText: '' },
  },
  text_image: {
    type: 'text_image', label: 'Text and image', allowedPages: allPages,
    defaultSettings: { ...contentDefaults, heading: 'Heading', bodyHtml: '<p>Add your content.</p>', imageFit: 'cover', imageRatio: 'landscape', imageSide: 'right', altText: '' },
  },
  divider: {
    type: 'divider', label: 'Divider', allowedPages: allPages,
    defaultSettings: { width: 'content', spacingTop: 'small', spacingBottom: 'small' },
  },
  spacer: {
    type: 'spacer', label: 'Spacer', allowedPages: allPages,
    defaultSettings: { spacingTop: 'medium', spacingBottom: 'medium' },
  },
  featured_products: {
    type: 'featured_products', label: 'Featured products', allowedPages: allPages,
    defaultSettings: { ...contentDefaults, heading: 'Featured products', productIds: [], productLimit: 4 },
  },
};

export const WHOLESALE_LAYOUT_AUTHENTICATED_PAGES = authenticatedPages;

export function getWholesaleLayoutSectionDefinition(type: string): WholesaleLayoutSectionDefinition | null {
  return WHOLESALE_LAYOUT_SECTION_REGISTRY[type as WholesaleLayoutSectionType] ?? null;
}