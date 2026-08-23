import type {
  StorefrontLayoutDocument,
  StorefrontLayoutPage,
  StorefrontLayoutSection,
  StorefrontLayoutSectionDefinition,
  StorefrontLayoutSectionSettings,
  StorefrontSectionAlignment,
  StorefrontSectionSpacing,
  StorefrontSectionWidth,
} from '@/lib/storefront/layout';

export const WHOLESALE_LAYOUT_SCHEMA_VERSION = 1 as const;

export const WHOLESALE_LAYOUT_PAGE_IDS = ['login', 'home', 'catalogue', 'cart', 'collection', 'product'] as const;
export type WholesaleLayoutPageId = typeof WHOLESALE_LAYOUT_PAGE_IDS[number];

export const WHOLESALE_LAYOUT_SECTION_TYPES = [
  'login_access',
  'home_welcome',
  'home_metrics',
  'home_workspace',
  'catalogue_browser',
  'collection_browser',
  'product_media_description',
  'product_variants',
  'cart_workflow',
  'banner',
  'rich_text',
  'image',
  'text_image',
  'divider',
  'spacer',
  'featured_products',
] as const;
export type WholesaleLayoutSectionType = typeof WHOLESALE_LAYOUT_SECTION_TYPES[number];

export type WholesaleSectionWidth = StorefrontSectionWidth;
export type WholesaleSectionAlignment = StorefrontSectionAlignment;
export type WholesaleSectionSpacing = StorefrontSectionSpacing;
export type WholesaleLayoutSectionSettings = StorefrontLayoutSectionSettings;
export type WholesaleLayoutSection = StorefrontLayoutSection<WholesaleLayoutSectionType>;
export type WholesaleLayoutPage = StorefrontLayoutPage<WholesaleLayoutSectionType>;
export type WholesaleLayoutDocument = StorefrontLayoutDocument<
  WholesaleLayoutPageId,
  WholesaleLayoutSectionType,
  typeof WHOLESALE_LAYOUT_SCHEMA_VERSION
>;
export type WholesaleLayoutSectionDefinition = StorefrontLayoutSectionDefinition<
  WholesaleLayoutPageId,
  WholesaleLayoutSectionType
>;