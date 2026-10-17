import { describe, expect, it } from 'vitest';

import { resolveHelpContext } from '../resolveHelpContext';
import type { HelpProduct } from '../types';
import { IMS_SETTINGS_MENU, type SettingsItem } from '@/lib/navigation/imsSettingsNavigation';

const contexts: Array<{ audience: 'ims' | 'pos' | 'wholesale'; product: HelpProduct; ids: string[] }> = [
  {
    audience: 'ims',
    product: 'ims',
    ids: [
      'dashboard', 'products', 'stock', 'brands', 'gift-cards', 'bulk-edit', 'bulk-add-edit', 'contacts', 'crm', 'contact-profile',
      'wholesale-applications', 'locations', 'purchase-orders', 'sales-orders', 'stock-availability', 'backorders',
      'customer-backorders', 'supplier-backorders', 'credit-notes', 'supplier-credit-notes', 'branch-transfers',
      'smart-device-receive', 'order-planner', 'receive-transfers', 'pos-sales', 'cash-banking', 'online-sales', 'stocktakes', 'reports',
      'report-sales-detail', 'report-sales-by-branch', 'report-sales-summary', 'report-sales-search',
      'report-cogs-traceability',
      'report-consignment-activity', 'consignment-statements',
      'report-inventory-valuation', 'report-product-margin', 'report-pos-price-changes', 'report-pos-registers',
      'report-cash-banking', 'report-stock-availability', 'xero', 'shopify', 'online-shop',
    ],
  },
  { audience: 'pos', product: 'pos', ids: ['pos', 'pos-receipt', 'daybook', 'eod', 'reports', 'parked', 'receive-transfers', 'branch-transfer'] },
  { audience: 'wholesale', product: 'wholesale', ids: ['home', 'catalogue', 'lists', 'orders', 'account', 'help'] },
  {
    audience: 'ims',
    product: 'ims',
    ids: [
      'home', 'ai-helper', 'business-intelligence', 'business-info', 'brand-profile', 'sync-data', 'calculated-data',
      'inventory', 'inactive-candidates', 'lost-candidates', 'space-analysis', 'stock-turnover', 'marketing', 'sync-ads',
      'marketing-assistant', 'planning-workspace', 'marketing-recommendations', 'creative-review', 'campaign-audit',
      'brand-assets', 'brand-assets-models', 'brand-assets-backdrops', 'brand-assets-poses', 'brand-assets-scenes',
      'brand-assets-templates', 'website', 'pending-online', 'product-description-template', 'bulk-edit-listings',
      'customer-service', 'cs-inbox', 'cs-compose', 'cs-templates', 'marketing-settings',
    ],
  },
  { audience: 'ims', product: 'setup', ids: ['connections', 'business', 'profile', 'pos', 'team'] },
];

describe('canonical Help context coverage', () => {
  it('opens model asset Help at the full-photo preview guidance', () => {
    const result = resolveHelpContext({ audience: 'ims', product: 'ims', context: 'brand-assets-models' });
    expect(result).toMatchObject({ exact: true, topic: { id: 'foresight-content-service' } });
    expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading).toBe('Model reference previews');
  });

  it('opens privacy guidance at the request and retention section', () => {
    const result = resolveHelpContext({ audience: 'ims', product: 'setup', context: 'privacy' });
    expect(result).toMatchObject({ exact: true, topic: { id: 'setup-team-access-security' } });
    expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading).toBe('Privacy information and requests');
  });

  it('opens Setup Help at the role-aware guidance section', () => {
    const result = resolveHelpContext({ audience: 'ims', product: 'setup', context: 'setup-help' });
    expect(result).toMatchObject({ exact: true, topic: { id: 'setup-connections' } });
    expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading).toBe('Finding setup guidance');
  });

  it('maps every settings leaf to current contextual guidance', () => {
    const check = (items: readonly SettingsItem[], superAdmin = false) => {
      for (const item of items) {
        const privileged = superAdmin || Boolean(item.superAdminOnly);
        if (item.children) check(item.children, privileged);
        else expect(resolveHelpContext({ audience: 'ims', product: 'ims', context: `settings-${item.id}`, userTier: privileged ? 'SuperAdmin' : 'Admin' }), item.id)
          .toEqual(expect.objectContaining({ exact: true }));
      }
    };
    check(IMS_SETTINGS_MENU);
  });
  it('opens targeted Amazon cleanup Help only for SuperAdmins', () => {
    const result = resolveHelpContext({ audience: 'ims', product: 'setup', context: 'amazon-pii-disposal', userTier: 'SuperAdmin' });
    expect(result).toMatchObject({ exact: true, topic: { id: 'setup-security-compliance' } });
    expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading).toBe('Amazon identifying-field cleanup');
    expect(resolveHelpContext({ audience: 'ims', product: 'setup', context: 'amazon-pii-disposal', userTier: 'Admin' })?.exact).toBe(false);
  });
  it('opens channel delivery settings for ordinary IMS users at the owning shipping section', () => {
    const result = resolveHelpContext({ audience: 'ims', product: 'ims', context: 'settings-delivery-tracking', userTier: 'Admin' });
    expect(result).toMatchObject({ exact: true, topic: { id: 'ims-shipping-settings' } });
    expect(result?.topic.sections.find(section => section.id === result.sectionId)?.heading).toBe('Delivery tracking by online channel');
  });
  it('maps security policies only for SuperAdmins', () => {
    expect(resolveHelpContext({ audience: 'ims', product: 'setup', context: 'security-compliance', userTier: 'SuperAdmin' }))
      .toMatchObject({ exact: true, topic: { id: 'setup-security-compliance' } });
    expect(resolveHelpContext({ audience: 'ims', product: 'setup', context: 'security-compliance', userTier: 'Admin' })?.exact)
      .toBe(false);
    expect(resolveHelpContext({ audience: 'ims', product: 'setup', context: 'amazon-pii-inventory', userTier: 'SuperAdmin' }))
      .toMatchObject({ exact: true, topic: { id: 'setup-security-compliance' } });
    expect(resolveHelpContext({ audience: 'ims', product: 'setup', context: 'amazon-pii-inventory', userTier: 'Admin' })?.exact)
      .toBe(false);
    expect(resolveHelpContext({ audience: 'ims', product: 'setup', context: 'amazon-delivery-evidence', userTier: 'SuperAdmin' }))
      .toMatchObject({ exact: true, topic: { id: 'setup-security-compliance' } });
    expect(resolveHelpContext({ audience: 'ims', product: 'setup', context: 'amazon-delivery-evidence', userTier: 'Admin' })?.exact)
      .toBe(false);
  });
  it.each(contexts)('maps every $product navigation context exactly', ({ audience, product, ids }) => {
    for (const context of ids) {
      expect(resolveHelpContext({ audience, product, context }), `${product}:${context}`).toEqual(expect.objectContaining({ exact: true }));
    }
  });
});