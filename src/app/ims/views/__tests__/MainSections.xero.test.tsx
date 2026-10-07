import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../ProductsSection', () => ({ ProductsSection: () => null }));
vi.mock('../OrdersSection', () => ({ OrdersSection: () => null }));
vi.mock('../ReportsSection', () => ({ ReportsSection: () => null }));
vi.mock('../contacts/ContactCrmProfile', () => ({ ContactCrmProfile: () => null }));
vi.mock('../wholesale/WholesaleApplicationQueue', () => ({ WholesaleApplicationQueue: () => null }));
vi.mock('../onlineShop/OnlineShopView', () => ({ default: () => null }));
vi.mock('../channels/SalesChannelsView', () => ({ default: () => null }));

import { MainSections } from '../MainSections';

describe('Xero advisor permissions', () => {
  it.each([true, false])('forwards payout access %s independently of mapping access', advisorPayoutsEnabled => {
    const XeroView = vi.fn(() => null);
    const props = {
      view: 'xero',
      xeroAccountingEnabled: true,
      isAdvisor: true,
      advisorMappingEnabled: false,
      advisorPayoutsEnabled,
      businessId: 'test-business',
      XeroView,
    } as React.ComponentProps<typeof MainSections>;
    renderToStaticMarkup(<MainSections {...props} />);
    expect(XeroView).toHaveBeenCalledWith(expect.objectContaining({
      advisorMappingEnabled: false,
      advisorPayoutsEnabled,
    }), expect.anything());
  });
});