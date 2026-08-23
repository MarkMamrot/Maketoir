import { normalizeStorefrontSectionSettings } from '@/lib/storefront/layoutValidation';
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
  return { schemaVersion: WHOLESALE_LAYOUT_SCHEMA_VERSION, pages };
}

export function isRequiredWholesaleLayoutSection(page: WholesaleLayoutPageId, type: WholesaleLayoutSectionType): boolean {
  return Boolean(WHOLESALE_LAYOUT_SECTION_REGISTRY[type].requiredOn?.includes(page));
}

export function getChangedWholesaleLayoutPages(
  draft: WholesaleLayoutDocument,
  published: WholesaleLayoutDocument,
): WholesaleLayoutPageId[] {
  return WHOLESALE_LAYOUT_PAGE_IDS.filter(page => JSON.stringify(draft.pages[page]) !== JSON.stringify(published.pages[page]));
}