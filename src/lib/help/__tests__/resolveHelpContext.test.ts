import { describe, expect, it } from 'vitest';

import { getHelpTopic, listHelpLibraryTopics, listHelpTopics, resolveHelpContext } from '../resolveHelpContext';
import { searchHelpTopics } from '../searchHelpTopics';

describe('resolveHelpContext', () => {
  it.each([
    ['report-consignment-activity', 'Consignment Activity'],
    ['consignment-statements', 'Consignment Statements'],
  ])('opens independent consignment guidance for %s without accounting', (context, heading) => {
    const result = resolveHelpContext({ audience: 'ims', product: 'ims', context, availableCapabilities: { xero: false } });
    expect(result).toMatchObject({ exact: true, topic: { id: 'ims-consignment' } });
    expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading).toBe(heading);
  });
  it('opens Feature Toggle help from the owning Settings context', () => {
    const result = resolveHelpContext({ audience: 'ims', product: 'ims', context: 'settings-feature-toggle' });
    expect(result?.exact).toBe(true);
    expect(result?.topic.id).toBe('ims-feature-toggle');
    expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading).toBe('Main operations');
  });
  it.each([true, false])('opens dedicated POS report procedures with accounting enabled=%s', xero => {
    for (const [context, heading] of [
      ['report-pos-price-changes', 'POS price changes: review recorded unit-price overrides'],
      ['report-pos-registers', 'Daily POS Registers: review sessions and counted takings'],
    ]) {
      const result = resolveHelpContext({ audience: 'ims', product: 'ims', context, availableCapabilities: { xero } });
      expect(result, context).toEqual(expect.objectContaining({
        exact: true,
        topic: expect.objectContaining({ id: 'ims-report-guide' }),
      }));
      expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading, context).toBe(heading);
    }
  });

  it.each([true, false])('gates Cash Banking Report context, browsing and search with accounting enabled=%s', xero => {
    const result = resolveHelpContext({
      audience: 'ims', product: 'ims', context: 'report-cash-banking', availableCapabilities: { xero },
    });
    expect(result?.exact).toBe(xero);
    expect(getHelpTopic('ims-cash-banking-report', 'ims', { xero })?.id)
      .toBe(xero ? 'ims-cash-banking-report' : undefined);
    if (xero) {
      expect(result?.topic.id).toBe('ims-cash-banking-report');
      expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading).toBe('Step-by-step');
    }
    const library = listHelpLibraryTopics('ims', 'ims', { xero });
    expect(library.some(topic => topic.id === 'ims-cash-banking-report')).toBe(xero);
    expect(searchHelpTopics(library, 'correction note').some(item => item.topic.id === 'ims-cash-banking-report')).toBe(xero);
    const overview = getHelpTopic('ims-operational-reports', 'ims', { xero });
    expect(overview?.sections.some(section => section.content.includes('Reports mainly review operational information'))).toBe(true);
    if (!xero) expect(JSON.stringify(overview)).not.toContain('Cash Banking Report');
  });

  it('opens Purchase Orders for its IMS view and child workflows', () => {
    for (const context of ['purchase-orders', 'purchase-order-detail']) {
      expect(resolveHelpContext({ audience: 'ims', product: 'ims', context })).toEqual(expect.objectContaining({
        exact: true,
        topic: expect.objectContaining({ id: 'ims-purchase-orders' }),
      }));
    }
    expect(resolveHelpContext({ audience: 'ims', product: 'ims', context: 'purchase-order-receive' })).toEqual(expect.objectContaining({
      exact: true,
      topic: expect.objectContaining({ id: 'ims-po-receiving-resolution' }),
    }));
  });

  it.each([true, false])('opens operational EOD help with accounting enabled=%s', xeroAccountingEnabled => {
    const result = resolveHelpContext({ audience: 'pos', product: 'pos', context: 'eod', xeroAccountingEnabled });
    expect(result).toEqual(expect.objectContaining({
      exact: true,
      topic: expect.objectContaining({ id: 'pos-end-of-day' }),
    }));
    expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading).toBe('Step-by-step');
  });

  it.each(['eod', 'pos-eod', 'pos-reports'])('preserves operational context %s without accounting', context => {
    expect(resolveHelpContext({ audience: 'pos', product: 'pos', context, availableCapabilities: { xero: false } }))
      .toEqual(expect.objectContaining({ exact: true, topic: expect.objectContaining({ id: 'pos-end-of-day' }) }));
  });

  it.each([true, false])('gates the separate EOD accounting topic with accounting enabled=%s', xero => {
    expect(getHelpTopic('pos-end-of-day-xero', 'pos', { xero })?.id)
      .toBe(xero ? 'pos-end-of-day-xero' : undefined);
    const result = resolveHelpContext({ audience: 'pos', product: 'pos', context: 'xero-pos-eod', availableCapabilities: { xero } });
    expect(result?.exact).toBe(xero);
    if (xero) expect(result?.topic.id).toBe('pos-end-of-day-xero');
  });

  it.each(['pos', 'ims'] as const)('keeps EOD searchable and linked for %s without accounting', audience => {
    const library = listHelpLibraryTopics(audience, audience, { xero: false });
    const eod = library.find(topic => topic.id === 'pos-end-of-day');
    expect(eod?.sections.some(section => section.heading === 'Step-by-step')).toBe(true);
    expect(searchHelpTopics(library, 'close register').some(result => result.topic.id === eod?.id)).toBe(true);
    expect(getHelpTopic('pos-register-device-login', audience, { xero: false })?.relatedTopics).toContain('pos-end-of-day');
    expect(eod?.relatedTopics).not.toContain('pos-end-of-day-xero');
    expect(library.every(topic => !/\bxero\b/i.test(JSON.stringify(topic)))).toBe(true);
  });

  it('excludes every Xero-bearing topic when tenant accounting is disabled', () => {
    const topics = listHelpTopics('ims', 'ims', false);
    expect(topics.every(topic => !/\bxero\b/i.test(JSON.stringify(topic)))).toBe(true);
    expect(topics.some(topic => topic.id === 'ims-purchase-orders')).toBe(true);
    expect(resolveHelpContext({ audience: 'ims', product: 'ims', context: 'xero', xeroAccountingEnabled: false })?.topic.id)
      .not.toBe('ims-xero-sync-reconciliation');
  });

  it('filters Shopify and Native Shop topics independently', () => {
    const shopifyOnly = listHelpTopics('ims', 'ims', { xero: true, shopify: true, native_shop: false });
    expect(shopifyOnly.some(topic => topic.id === 'ims-shopify-sync')).toBe(true);
    expect(shopifyOnly.some(topic => topic.id === 'ims-online-shop')).toBe(false);

    const nativeOnly = listHelpTopics('ims', 'ims', { xero: true, shopify: false, native_shop: true });
    expect(nativeOnly.some(topic => topic.id === 'ims-shopify-sync')).toBe(false);
    expect(nativeOnly.some(topic => topic.id === 'ims-online-shop')).toBe(true);
  });

  it('opens Store Daybook help from the Daybook screen', () => {
    expect(resolveHelpContext({ audience: 'pos', product: 'pos', context: 'daybook' })).toEqual(expect.objectContaining({
      exact: true,
      topic: expect.objectContaining({ id: 'pos-store-daybook' }),
    }));
  });

  it('never returns IMS-only topics to wholesale users', () => {
    expect(listHelpTopics('wholesale').every(topic => topic.audiences.includes('wholesale'))).toBe(true);
    expect(resolveHelpContext({ audience: 'wholesale', product: 'ims', context: 'purchase-orders' })).toBeNull();
  });

  it('includes shared references in product topic lists without taking over contextual routing', () => {
    const topics = listHelpTopics('pos', 'pos');
    expect(topics.some(topic => topic.id === 'shared-plain-language-glossary')).toBe(true);
    expect(new Set(topics.map(topic => topic.product))).toEqual(new Set(['pos', 'shared']));
    expect(topics.some(topic => topic.product === 'ims')).toBe(false);
    expect(resolveHelpContext({ audience: 'pos', product: 'pos', context: 'pos' })).toEqual(expect.objectContaining({
      topic: expect.objectContaining({ product: 'pos' }),
    }));
  });

  it('lists every topic available to an IMS audience when no product filter is supplied', () => {
    const topics = listHelpTopics('ims');
    expect(topics.every(topic => topic.audiences.includes('ims'))).toBe(true);
    expect(topics.some(topic => topic.product === 'ims')).toBe(true);
    expect(topics.some(topic => topic.id === 'foresight-workspaces' && topic.product === 'ims')).toBe(true);
    expect(topics.some(topic => topic.product === 'foresight')).toBe(false);
    expect(topics.some(topic => topic.product === 'setup')).toBe(true);
    expect(topics.some(topic => topic.product === 'pos')).toBe(true);
  });

  it('broadens IMS browsing without broadening POS, Setup or Wholesale audiences', () => {
    expect(new Set(listHelpLibraryTopics('ims', 'ims').map(topic => topic.product))).toEqual(new Set(['ims', 'pos', 'setup', 'shared']));
    expect(new Set(listHelpLibraryTopics('pos', 'pos').map(topic => topic.product))).toEqual(new Set(['pos', 'shared']));
    expect(new Set(listHelpLibraryTopics('wholesale', 'wholesale').map(topic => topic.product))).toEqual(new Set(['wholesale', 'shared']));
    expect(new Set(listHelpLibraryTopics('ims', 'setup').map(topic => topic.product))).toEqual(new Set(['setup', 'shared']));
    expect(resolveHelpContext({ audience: 'ims', product: 'ims', context: 'reports' })?.topic.product).toBe('ims');
  });

  it.each([undefined, 'StandardUser', 'Admin', 'Advisor'])('denies platform topics consistently for tier %s', userTier => {
    const library = listHelpLibraryTopics('ims', 'ims', undefined, userTier);
    expect(library.some(topic => topic.navigation.category === 'platform')).toBe(false);
    expect(searchHelpTopics(library, 'scheduled jobs').some(result => result.topic.id === 'setup-cron-jobs')).toBe(false);
    expect(getHelpTopic('setup-cron-jobs', 'ims', undefined, userTier)).toBeNull();
    expect(resolveHelpContext({ audience: 'ims', product: 'setup', context: 'cron-jobs', userTier })?.topic.id).not.toBe('setup-cron-jobs');
  });

  it('allows the separate platform branch and exact contexts only for SuperAdmins', () => {
    const library = listHelpLibraryTopics('ims', 'ims', undefined, 'SuperAdmin');
    expect(library.filter(topic => topic.navigation.category === 'platform')).toHaveLength(6);
    expect(getHelpTopic('setup-cron-jobs', 'ims', undefined, 'SuperAdmin')?.id).toBe('setup-cron-jobs');
    expect(resolveHelpContext({ audience: 'ims', product: 'setup', context: 'cron-jobs', userTier: 'SuperAdmin' })?.exact).toBe(true);
  });

  it('preserves integration capability filtering across the broader IMS library', () => {
    const library = listHelpLibraryTopics('ims', 'ims', { xero: false, shopify: false, native_shop: false }, 'SuperAdmin');
    expect(library.every(topic => !/\bxero\b/i.test(JSON.stringify(topic)))).toBe(true);
    expect(library.some(topic => topic.id === 'ims-shopify-sync' || topic.id === 'ims-online-shop')).toBe(false);
    expect(library.some(topic => topic.id === 'pos-end-of-day-xero')).toBe(false);
    expect(library.some(topic => topic.id === 'pos-selling-payments-manager-approval')).toBe(true);
  });
});