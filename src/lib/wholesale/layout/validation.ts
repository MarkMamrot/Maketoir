import { normalizeStorefrontSectionSettings, validStorefrontColor } from '@/lib/storefront/layoutValidation';
import { getWholesaleLayoutSectionDefinition, WHOLESALE_LAYOUT_SECTION_REGISTRY } from './registry';
import {
  WHOLESALE_LAYOUT_PAGE_IDS,
  WHOLESALE_LAYOUT_SCHEMA_VERSION,
  WHOLESALE_THEME_COLOR_KEYS,
  type WholesaleLayoutDocument,
  type WholesaleLayoutPageId,
  type WholesalePageThemeColors,
  type WholesaleThemeColors,
  type WholesaleLayoutSection,
  type WholesaleLayoutSectionSettings,
  type WholesaleLayoutSectionType,
} from './types';

const MAX_SECTIONS_PER_PAGE = 40;
export const DEFAULT_WHOLESALE_THEME_COLORS: WholesaleThemeColors = {
  primary: '#145d4e',
  secondary: '#33423b',
  accent: '#d69e2e',
  pageBackground: '#f4f6f3',
  surface: '#ffffff',
  text: '#17201c',
  mutedText: '#65736c',
};
const DEFAULT_SECTION_ORDER: Record<WholesaleLayoutPageId, WholesaleLayoutSectionType[]> = {
  login: ['login_access'],
  home: ['home_welcome', 'home_metrics', 'home_workspace'],
  catalogue: ['catalogue_browser'],
  cart: ['cart_workflow'],
  collection: ['collection_browser'],
  product: ['product_media_description', 'product_variants'],
};

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
    theme: { colors: { ...DEFAULT_WHOLESALE_THEME_COLORS }, pageOverrides: {} },
  };
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLength);
}

function normalizeTheme(candidate: Record<string, any>): WholesaleLayoutDocument['theme'] {
  const rawColors = candidate.theme?.colors && typeof candidate.theme.colors === 'object' ? candidate.theme.colors : {};
  const colors = { ...DEFAULT_WHOLESALE_THEME_COLORS };
  for (const key of WHOLESALE_THEME_COLOR_KEYS) colors[key] = validStorefrontColor(rawColors[key]) ?? colors[key];

  const pageOverrides: WholesaleLayoutDocument['theme']['pageOverrides'] = {};
  for (const page of WHOLESALE_LAYOUT_PAGE_IDS) {
    const rawOverride = candidate.theme?.pageOverrides?.[page];
    if (!rawOverride || typeof rawOverride !== 'object') continue;
    const override: WholesalePageThemeColors = {};
    for (const key of WHOLESALE_THEME_COLOR_KEYS) {
      const color = validStorefrontColor(rawOverride[key]);
      if (color) override[key] = color;
    }
    if (Object.keys(override).length > 0) pageOverrides[page] = override;
  }
  return { colors, pageOverrides };
}

export function resolveWholesaleThemeColors(document: WholesaleLayoutDocument, page: WholesaleLayoutPageId): WholesaleThemeColors {
  return { ...document.theme.colors, ...(document.theme.pageOverrides[page] ?? {}) };
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
      sections.push({ id, type: definition.type, settings: normalizeStorefrontSectionSettings(rawSection?.settings, definition.defaultSettings) });
    }
    for (const type of DEFAULT_SECTION_ORDER[page]) {
      const definition = WHOLESALE_LAYOUT_SECTION_REGISTRY[type];
      if (definition.requiredOn?.includes(page) && !sections.some(section => section.type === type)) {
        sections.push(defaultSection(page, type));
      }
    }
    pages[page] = { sections };
  }
  return { schemaVersion: WHOLESALE_LAYOUT_SCHEMA_VERSION, pages, theme: normalizeTheme(candidate) };
}

export function isRequiredWholesaleLayoutSection(page: WholesaleLayoutPageId, type: WholesaleLayoutSectionType): boolean {
  return Boolean(WHOLESALE_LAYOUT_SECTION_REGISTRY[type].requiredOn?.includes(page));
}

export function getChangedWholesaleLayoutPages(
  draft: WholesaleLayoutDocument,
  published: WholesaleLayoutDocument,
): WholesaleLayoutPageId[] {
  const sharedThemeChanged = JSON.stringify(draft.theme.colors) !== JSON.stringify(published.theme.colors);
  return WHOLESALE_LAYOUT_PAGE_IDS.filter(page => sharedThemeChanged
    || JSON.stringify(draft.pages[page]) !== JSON.stringify(published.pages[page])
    || JSON.stringify(draft.theme.pageOverrides[page] ?? {}) !== JSON.stringify(published.theme.pageOverrides[page] ?? {}));
}