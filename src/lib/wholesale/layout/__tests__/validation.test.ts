import { describe, expect, it } from 'vitest';
import { createDefaultWholesaleLayout, getChangedWholesaleLayoutPages, isRequiredWholesaleLayoutSection, normalizeWholesaleLayoutDocument, resolveWholesaleThemeColors } from '../validation';

describe('wholesale layout validation', () => {
  it('identifies only page templates changed from the published document', () => {
    const published = createDefaultWholesaleLayout();
    const draft = structuredClone(published);
    draft.pages.home.sections.push({ id: 'home-banner', type: 'banner', settings: { heading: 'New' } });
    draft.pages.product.sections.reverse();

    expect(getChangedWholesaleLayoutPages(draft, published)).toEqual(['home', 'product']);
    expect(getChangedWholesaleLayoutPages(published, published)).toEqual([]);
  });

  it('encodes current required composite sections in deterministic defaults', () => {
    const layout = createDefaultWholesaleLayout();
    expect(layout.pages.product.sections.map(section => section.type)).toEqual([
      'product_media_description',
      'product_variants',
    ]);
    expect(layout.pages.login.sections[0].id).toBe('login-login_access');
    expect(isRequiredWholesaleLayoutSection('product', 'product_media_description')).toBe(true);
  });

  it('restores required sections and drops unknown or page-incompatible sections', () => {
    const layout = normalizeWholesaleLayoutDocument({
      schemaVersion: 1,
      pages: {
        login: { sections: [{ id: 'bad', type: 'cart_workflow', settings: {} }] },
        product: { sections: [{ id: 'copy', type: 'banner', settings: { heading: 'Hello' } }] },
      },
    });
    expect(layout.pages.login.sections.map(section => section.type)).toEqual(['login_access']);
    expect(layout.pages.product.sections.map(section => section.type)).toEqual([
      'banner',
      'product_media_description',
      'product_variants',
    ]);
  });

  it('deduplicates singleton sections and section IDs', () => {
    const layout = normalizeWholesaleLayoutDocument({
      schemaVersion: 1,
      pages: {
        catalogue: { sections: [
          { id: 'same', type: 'catalogue_browser', settings: {} },
          { id: 'other', type: 'catalogue_browser', settings: {} },
          { id: 'same', type: 'banner', settings: {} },
        ] },
      },
    });
    expect(layout.pages.catalogue.sections).toHaveLength(2);
    expect(new Set(layout.pages.catalogue.sections.map(section => section.id)).size).toBe(2);
  });

  it('bounds settings and rejects unsafe URLs and colors', () => {
    const layout = normalizeWholesaleLayoutDocument({
      schemaVersion: 1,
      pages: {
        home: { sections: [{
          id: 'banner-1', type: 'banner', settings: {
            heading: 'x'.repeat(400), linkUrl: 'javascript:alert(1)', backgroundColor: 'red; position: fixed',
            productIds: Array.from({ length: 30 }, (_, index) => `p-${index}`), productLimit: 99,
          },
        }] },
      },
    });
    const settings = layout.pages.home.sections[0].settings;
    expect(settings.heading).toHaveLength(255);
    expect(settings.linkUrl).toBeUndefined();
    expect(settings.backgroundColor).toBeUndefined();
    expect(settings.productIds).toHaveLength(24);
    expect(settings.productLimit).toBe(12);
  });

  it('normalizes shared theme colours and resolves page overrides', () => {
    const layout = normalizeWholesaleLayoutDocument({
      ...createDefaultWholesaleLayout(),
      theme: {
        colors: { primary: '#123456', accent: 'red; position: fixed' },
        pageOverrides: { product: { primary: '#abcdef', surface: 'url(javascript:bad)' } },
      },
    });
    expect(layout.theme.colors.primary).toBe('#123456');
    expect(layout.theme.colors.accent).toBe('#d69e2e');
    expect(resolveWholesaleThemeColors(layout, 'product')).toMatchObject({ primary: '#abcdef', surface: '#ffffff' });
  });

  it('tracks page and shared theme changes', () => {
    const published = createDefaultWholesaleLayout();
    const pageDraft = structuredClone(published);
    pageDraft.theme.pageOverrides.cart = { pageBackground: '#eeeeee' };
    expect(getChangedWholesaleLayoutPages(pageDraft, published)).toEqual(['cart']);
    const sharedDraft = structuredClone(published);
    sharedDraft.theme.colors.primary = '#112233';
    expect(getChangedWholesaleLayoutPages(sharedDraft, published)).toEqual(['login', 'home', 'catalogue', 'cart', 'collection', 'product']);
  });

  it('sanitizes rich content with an allowlist', () => {
    const layout = normalizeWholesaleLayoutDocument({
      schemaVersion: 1,
      pages: { home: { sections: [{ id: 'text-1', type: 'rich_text', settings: {
        bodyHtml: '<p onclick="alert(1)">Hello <strong>buyer</strong><script>alert(2)</script><a href="javascript:alert(3)">bad</a><a href="https://example.com">good</a></p>',
      } }] } },
    });
    expect(layout.pages.home.sections[0].settings.bodyHtml).toBe('<p>Hello <strong>buyer</strong><a target="_blank" rel="noopener noreferrer">bad</a><a href="https://example.com" target="_blank" rel="noopener noreferrer">good</a></p>');
  });

  it('falls back completely for unsupported schema versions', () => {
    expect(normalizeWholesaleLayoutDocument({ schemaVersion: 99, pages: {} })).toEqual(createDefaultWholesaleLayout());
  });
});