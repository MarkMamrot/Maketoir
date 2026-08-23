export type StorefrontSectionWidth = 'narrow' | 'content' | 'full';
export type StorefrontSectionAlignment = 'left' | 'center' | 'right';
export type StorefrontSectionSpacing = 'none' | 'small' | 'medium' | 'large';

export interface StorefrontLayoutSectionSettings {
  width?: StorefrontSectionWidth;
  alignment?: StorefrontSectionAlignment;
  spacingTop?: StorefrontSectionSpacing;
  spacingBottom?: StorefrontSectionSpacing;
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

export interface StorefrontLayoutSection<
  SectionType extends string,
  Settings extends StorefrontLayoutSectionSettings = StorefrontLayoutSectionSettings,
> {
  id: string;
  type: SectionType;
  settings: Settings;
}

export interface StorefrontLayoutPage<
  SectionType extends string,
  Settings extends StorefrontLayoutSectionSettings = StorefrontLayoutSectionSettings,
> {
  sections: Array<StorefrontLayoutSection<SectionType, Settings>>;
}

export interface StorefrontLayoutDocument<
  PageId extends string,
  SectionType extends string,
  SchemaVersion extends number = number,
  Settings extends StorefrontLayoutSectionSettings = StorefrontLayoutSectionSettings,
> {
  schemaVersion: SchemaVersion;
  pages: Record<PageId, StorefrontLayoutPage<SectionType, Settings>>;
}

export interface StorefrontLayoutSectionDefinition<
  PageId extends string,
  SectionType extends string,
  Settings extends StorefrontLayoutSectionSettings = StorefrontLayoutSectionSettings,
> {
  type: SectionType;
  label: string;
  allowedPages: readonly PageId[];
  requiredOn?: readonly PageId[];
  singleton?: boolean;
  defaultSettings: Settings;
}