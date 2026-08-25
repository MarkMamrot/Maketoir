import { describe, expect, it } from 'vitest';

import { resolveHelpContext } from '../resolveHelpContext';
import type { HelpProduct } from '../types';

const contexts: Array<{ audience: 'ims' | 'pos' | 'wholesale'; product: HelpProduct; ids: string[] }> = [
  {
    audience: 'ims',
    product: 'ims',
    ids: [
      'dashboard', 'products', 'stock', 'brands', 'gift-cards', 'bulk-edit', 'contacts', 'crm', 'contact-profile',
      'wholesale-applications', 'locations', 'purchase-orders', 'sales-orders', 'stock-availability', 'backorders',
      'customer-backorders', 'supplier-backorders', 'credit-notes', 'supplier-credit-notes', 'branch-transfers',
      'smart-device-receive', 'order-planner', 'receive-transfers', 'pos-sales', 'online-sales', 'stocktakes', 'reports',
      'report-sales-detail', 'report-sales-by-branch', 'report-sales-summary', 'report-sales-search',
      'report-inventory-valuation', 'report-product-margin', 'report-pos-price-changes', 'report-pos-registers',
      'report-cash-banking', 'report-stock-availability', 'xero', 'shopify', 'online-shop',
    ],
  },
  { audience: 'pos', product: 'pos', ids: ['pos', 'daybook', 'eod', 'reports', 'parked', 'receive-transfers', 'branch-transfer'] },
  { audience: 'wholesale', product: 'wholesale', ids: ['home', 'catalogue', 'lists', 'orders', 'account', 'help'] },
  {
    audience: 'ims',
    product: 'foresight',
    ids: [
      'home', 'ai-helper', 'business-intelligence', 'business-info', 'brand-profile', 'sync-data', 'calculated-data',
      'inventory', 'inactive-candidates', 'lost-candidates', 'space-analysis', 'stock-turnover', 'marketing', 'sync-ads',
      'marketing-assistant', 'planning-workspace', 'marketing-recommendations', 'creative-review', 'campaign-audit',
      'brand-assets', 'brand-assets-models', 'brand-assets-backdrops', 'brand-assets-poses', 'brand-assets-scenes',
      'brand-assets-templates', 'website', 'pending-online', 'product-description-template', 'bulk-edit-listings',
      'customer-service', 'cs-inbox', 'cs-compose', 'cs-templates', 'appearance', 'connections', 'marketing-settings', 'data-source',
    ],
  },
  { audience: 'ims', product: 'setup', ids: ['connections', 'business', 'profile', 'appearance', 'pos', 'data-source', 'team'] },
];

describe('canonical Help context coverage', () => {
  it.each(contexts)('maps every $product navigation context exactly', ({ audience, product, ids }) => {
    for (const context of ids) {
      expect(resolveHelpContext({ audience, product, context }), `${product}:${context}`).toEqual(expect.objectContaining({ exact: true }));
    }
  });
});