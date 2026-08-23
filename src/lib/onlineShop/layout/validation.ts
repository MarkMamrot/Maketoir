import { normalizeStorefrontSectionSettings } from '@/lib/storefront/layoutValidation';
import { getOnlineShopLayoutSectionDefinition, ONLINE_SHOP_LAYOUT_SECTION_REGISTRY } from './registry';
import {
  ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION,
  ONLINE_SHOP_LAYOUT_PAGE_IDS,
  ONLINE_SHOP_LAYOUT_SCHEMA_VERSION,
  ONLINE_SHOP_SHARED_SECTION_TYPES,
  type OnlineShopContentPageDocument,
  type OnlineShopLayoutDocument,
  type OnlineShopLayoutPageId,
  type OnlineShopLayoutSection,
  type OnlineShopLayoutSectionType,
  type OnlineShopSharedSectionType,
} from './types';

const MAX_SECTIONS = 40;
const DEFAULT_ORDER: Record<OnlineShopLayoutPageId, OnlineShopLayoutSectionType[]> = {
  home: ['shop_home'], catalogue: ['shop_catalogue'], collection: ['shop_collection'],
  product: ['shop_product_media', 'shop_product_purchase'], cart: ['shop_cart'], checkout: ['shop_checkout'],
  login: ['shop_login'], account: ['shop_account'],
};

function safeId(value: unknown, fallback: string, seen: Set<string>): string {
  const candidate = typeof value === 'string' ? value.trim().slice(0, 100) : '';
  const id = candidate && /^[a-zA-Z0-9_-]+$/.test(candidate) && !seen.has(candidate) ? candidate : fallback;
  seen.add(id);
  return id;
}

function defaultSection(page: OnlineShopLayoutPageId, type: OnlineShopLayoutSectionType): OnlineShopLayoutSection {
  return { id: `${page}-${type}`, type, settings: { ...ONLINE_SHOP_LAYOUT_SECTION_REGISTRY[type].defaultSettings } };
}

export function createDefaultOnlineShopLayout(): OnlineShopLayoutDocument {
  return {
    schemaVersion: ONLINE_SHOP_LAYOUT_SCHEMA_VERSION,
    pages: Object.fromEntries(ONLINE_SHOP_LAYOUT_PAGE_IDS.map(page => [page, { sections: DEFAULT_ORDER[page].map(type => defaultSection(page, type)) }])) as OnlineShopLayoutDocument['pages'],
  };
}

export function normalizeOnlineShopLayoutDocument(raw: unknown): OnlineShopLayoutDocument {
  const defaults = createDefaultOnlineShopLayout();
  if (!raw || typeof raw !== 'object') return defaults;
  const candidate = raw as Record<string, any>;
  if (candidate.schemaVersion !== ONLINE_SHOP_LAYOUT_SCHEMA_VERSION || !candidate.pages || typeof candidate.pages !== 'object') return defaults;
  const pages = { ...defaults.pages };
  for (const page of ONLINE_SHOP_LAYOUT_PAGE_IDS) {
    const input = Array.isArray(candidate.pages[page]?.sections) ? candidate.pages[page].sections : [];
    const seenIds = new Set<string>();
    const seenSingletons = new Set<OnlineShopLayoutSectionType>();
    const sections: OnlineShopLayoutSection[] = [];
    for (const rawSection of input.slice(0, MAX_SECTIONS)) {
      const definition = getOnlineShopLayoutSectionDefinition(rawSection?.type);
      if (!definition || !definition.allowedPages.includes(page) || (definition.singleton && seenSingletons.has(definition.type))) continue;
      const id = safeId(rawSection?.id, `${page}-${definition.type}-${sections.length + 1}`, seenIds);
      if (definition.singleton) seenSingletons.add(definition.type);
      sections.push({ id, type: definition.type, settings: normalizeStorefrontSectionSettings(rawSection?.settings, definition.defaultSettings) });
    }
    for (const type of DEFAULT_ORDER[page]) {
      if (!sections.some(section => section.type === type)) sections.push(defaultSection(page, type));
    }
    pages[page] = { sections };
  }
  return { schemaVersion: ONLINE_SHOP_LAYOUT_SCHEMA_VERSION, pages };
}

export function createDefaultOnlineShopContentPage(): OnlineShopContentPageDocument {
  return { schemaVersion: ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION, sections: [] };
}

export function normalizeOnlineShopContentPage(raw: unknown): OnlineShopContentPageDocument {
  if (!raw || typeof raw !== 'object') return createDefaultOnlineShopContentPage();
  const candidate = raw as Record<string, any>;
  if (candidate.schemaVersion !== ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION || !Array.isArray(candidate.sections)) return createDefaultOnlineShopContentPage();
  const shared = new Set<string>(ONLINE_SHOP_SHARED_SECTION_TYPES);
  const seenIds = new Set<string>();
  const sections = candidate.sections.slice(0, MAX_SECTIONS).flatMap((rawSection: any, index: number) => {
    if (!shared.has(rawSection?.type)) return [];
    const type = rawSection.type as OnlineShopSharedSectionType;
    const definition = ONLINE_SHOP_LAYOUT_SECTION_REGISTRY[type];
    return [{ id: safeId(rawSection?.id, `page-${type}-${index + 1}`, seenIds), type,
      settings: normalizeStorefrontSectionSettings(rawSection?.settings, definition.defaultSettings) }];
  });
  return { schemaVersion: ONLINE_SHOP_CONTENT_PAGE_SCHEMA_VERSION, sections };
}