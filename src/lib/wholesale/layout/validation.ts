import { getWholesaleLayoutSectionDefinition, WHOLESALE_LAYOUT_SECTION_REGISTRY } from './registry';
import {
  WHOLESALE_LAYOUT_PAGE_IDS,
  WHOLESALE_LAYOUT_SCHEMA_VERSION,
  type WholesaleLayoutDocument,
  type WholesaleLayoutPageId,
  type WholesaleLayoutSection,
  type WholesaleLayoutSectionSettings,
  type WholesaleLayoutSectionType,
} from './types';

const MAX_SECTIONS_PER_PAGE = 40;
const DEFAULT_SECTION_ORDER: Record<WholesaleLayoutPageId, WholesaleLayoutSectionType[]> = {
  login: ['login_access'],
  home: ['home_welcome', 'home_metrics', 'home_workspace'],
  catalogue: ['catalogue_browser'],
  cart: ['cart_workflow'],
  collection: ['collection_browser'],
  product: ['product_media_description', 'product_variants'],
};

const widths = new Set(['narrow', 'content', 'full']);
const alignments = new Set(['left', 'center', 'right']);
const spacings = new Set(['none', 'small', 'medium', 'large']);
const imageFits = new Set(['cover', 'contain']);
const imageRatios = new Set(['landscape', 'square', 'portrait']);

function sectionId(page: WholesaleLayoutPageId, type: WholesaleLayoutSectionType) {
  return `${page}-${type}`;
}

function defaultSection(page: WholesaleLayoutPageId, type: WholesaleLayoutSectionType): WholesaleLayoutSection {
  const definition = WHOLESALE_LAYOUT_SECTION_REGISTRY[type];
  return { id: sectionId(page, type), type, settings: { ...definition.defaultSettings } };
}

export function createDefaultWholesaleLayout(): WholesaleLayoutDocument {
  return {
    schemaVersion: WHOLESALE_LAYOUT_SCHEMA_VERSION,
    pages: Object.fromEntries(WHOLESALE_LAYOUT_PAGE_IDS.map(page => [
      page,
      { sections: DEFAULT_SECTION_ORDER[page].map(type => defaultSection(page, type)) },
    ])) as WholesaleLayoutDocument['pages'],
  };
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLength);
}

function validUrl(value: unknown): string | undefined {
  const url = boundedString(value, 2048);
  if (!url) return undefined;
  if (url.startsWith('/')) return url;
  try { return new URL(url).protocol === 'https:' ? url : undefined; } catch { return undefined; }
}

function validColor(value: unknown): string | undefined {
  const color = boundedString(value, 32);
  return color && /^(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\)|rgba\([\d\s,.%]+\))$/i.test(color) ? color : undefined;
}

function normalizeSettings(raw: unknown, defaults: WholesaleLayoutSectionSettings): WholesaleLayoutSectionSettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const settings: WholesaleLayoutSectionSettings = { ...defaults };
  if (widths.has(String(value.width))) settings.width = value.width as WholesaleLayoutSectionSettings['width'];
  if (alignments.has(String(value.alignment))) settings.alignment = value.alignment as WholesaleLayoutSectionSettings['alignment'];
  if (spacings.has(String(value.spacingTop))) settings.spacingTop = value.spacingTop as WholesaleLayoutSectionSettings['spacingTop'];
  if (spacings.has(String(value.spacingBottom))) settings.spacingBottom = value.spacingBottom as WholesaleLayoutSectionSettings['spacingBottom'];
  if (imageFits.has(String(value.imageFit))) settings.imageFit = value.imageFit as WholesaleLayoutSectionSettings['imageFit'];
  if (imageRatios.has(String(value.imageRatio))) settings.imageRatio = value.imageRatio as WholesaleLayoutSectionSettings['imageRatio'];
  if (value.imageSide === 'left' || value.imageSide === 'right') settings.imageSide = value.imageSide;
  settings.backgroundColor = validColor(value.backgroundColor);
  settings.textColor = validColor(value.textColor);
  settings.heading = boundedString(value.heading, 255);
  settings.bodyHtml = boundedString(value.bodyHtml, 20_000);
  settings.imageUrl = validUrl(value.imageUrl);
  settings.assetId = boundedString(value.assetId, 64);
  settings.altText = boundedString(value.altText, 500);
  settings.linkUrl = validUrl(value.linkUrl);
  settings.linkLabel = boundedString(value.linkLabel, 100);
  settings.productIds = Array.isArray(value.productIds)
    ? [...new Set(value.productIds.map(item => boundedString(item, 100)).filter((item): item is string => Boolean(item)))].slice(0, 24)
    : defaults.productIds;
  if (Number.isSafeInteger(value.productLimit)) settings.productLimit = Math.min(12, Math.max(1, Number(value.productLimit)));
  return Object.fromEntries(Object.entries(settings).filter(([, item]) => item !== undefined));
}

export function normalizeWholesaleLayoutDocument(raw: unknown): WholesaleLayoutDocument {
  const defaults = createDefaultWholesaleLayout();
  if (!raw || typeof raw !== 'object') return defaults;
  const candidate = raw as Record<string, any>;
  if (candidate.schemaVersion !== WHOLESALE_LAYOUT_SCHEMA_VERSION || !candidate.pages || typeof candidate.pages !== 'object') return defaults;

  const pages = { ...defaults.pages };
  for (const page of WHOLESALE_LAYOUT_PAGE_IDS) {
    const inputSections = Array.isArray(candidate.pages[page]?.sections) ? candidate.pages[page].sections : [];
    const seenIds = new Set<string>();
    const seenSingletons = new Set<WholesaleLayoutSectionType>();
    const sections: WholesaleLayoutSection[] = [];
    for (const rawSection of inputSections.slice(0, MAX_SECTIONS_PER_PAGE)) {
      const definition = getWholesaleLayoutSectionDefinition(rawSection?.type);
      if (!definition || !definition.allowedPages.includes(page)) continue;
      if (definition.singleton && seenSingletons.has(definition.type)) continue;
      const rawId = boundedString(rawSection?.id, 100);
      const id = rawId && /^[a-zA-Z0-9_-]+$/.test(rawId) && !seenIds.has(rawId)
        ? rawId
        : `${page}-${definition.type}-${sections.length + 1}`;
      seenIds.add(id);
      if (definition.singleton) seenSingletons.add(definition.type);
      sections.push({ id, type: definition.type, settings: normalizeSettings(rawSection?.settings, definition.defaultSettings) });
    }
    for (const type of DEFAULT_SECTION_ORDER[page]) {
      const definition = WHOLESALE_LAYOUT_SECTION_REGISTRY[type];
      if (definition.requiredOn?.includes(page) && !sections.some(section => section.type === type)) {
        sections.push(defaultSection(page, type));
      }
    }
    pages[page] = { sections };
  }
  return { schemaVersion: WHOLESALE_LAYOUT_SCHEMA_VERSION, pages };
}

export function isRequiredWholesaleLayoutSection(page: WholesaleLayoutPageId, type: WholesaleLayoutSectionType): boolean {
  return Boolean(WHOLESALE_LAYOUT_SECTION_REGISTRY[type].requiredOn?.includes(page));
}