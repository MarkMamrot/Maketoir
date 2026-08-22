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

export type WholesaleSectionWidth = 'narrow' | 'content' | 'full';
export type WholesaleSectionAlignment = 'left' | 'center' | 'right';
export type WholesaleSectionSpacing = 'none' | 'small' | 'medium' | 'large';

export interface WholesaleLayoutSectionSettings {
  width?: WholesaleSectionWidth;
  alignment?: WholesaleSectionAlignment;
  spacingTop?: WholesaleSectionSpacing;
  spacingBottom?: WholesaleSectionSpacing;
  backgroundColor?: string;
  textColor?: string;
  heading?: string;
  bodyHtml?: string;
  imageUrl?: string;
  assetId?: string;
  altText?: string;
  linkUrl?: string;
  linkLabel?: string;
  imageFit?: 'cover' | 'contain';
  imageRatio?: 'landscape' | 'square' | 'portrait';
  imageSide?: 'left' | 'right';
  productIds?: string[];
  productLimit?: number;
}

export interface WholesaleLayoutSection {
  id: string;
  type: WholesaleLayoutSectionType;
  settings: WholesaleLayoutSectionSettings;
}

export interface WholesaleLayoutPage {
  sections: WholesaleLayoutSection[];
}

export interface WholesaleLayoutDocument {
  schemaVersion: typeof WHOLESALE_LAYOUT_SCHEMA_VERSION;
  pages: Record<WholesaleLayoutPageId, WholesaleLayoutPage>;
}

export interface WholesaleLayoutSectionDefinition {
  type: WholesaleLayoutSectionType;
  label: string;
  allowedPages: readonly WholesaleLayoutPageId[];
  requiredOn?: readonly WholesaleLayoutPageId[];
  singleton?: boolean;
  defaultSettings: WholesaleLayoutSectionSettings;
}