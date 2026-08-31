import { describe, expect, it } from 'vitest';

import { listHelpTopics, resolveHelpContext } from '../resolveHelpContext';

describe('resolveHelpContext', () => {
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

  it('opens POS EOD and Xero help from the EOD screen', () => {
    expect(resolveHelpContext({ audience: 'pos', product: 'pos', context: 'eod' })).toEqual(expect.objectContaining({
      exact: true,
      topic: expect.objectContaining({ id: 'pos-end-of-day-xero' }),
    }));
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
    expect(topics.some(topic => topic.product === 'foresight')).toBe(true);
    expect(topics.some(topic => topic.product === 'setup')).toBe(true);
    expect(topics.some(topic => topic.product === 'pos')).toBe(true);
  });
});