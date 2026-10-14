import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../ProductsSection', () => ({ ProductsSection: () => null }));
vi.mock('../OrdersSection', () => ({ OrdersSection: () => null }));
vi.mock('../ReportsSection', () => ({ ReportsSection: () => null }));
vi.mock('../contacts/ContactCrmProfile', () => ({ ContactCrmProfile: () => null }));
vi.mock('../wholesale/WholesaleApplicationQueue', () => ({ WholesaleApplicationQueue: () => null }));
vi.mock('../onlineShop/OnlineShopView', () => ({ default: () => null }));
vi.mock('../channels/SalesChannelsView', () => ({ default: vi.fn(() => null) }));

import { MainSections } from '../MainSections';
import SalesChannelsView from '../channels/SalesChannelsView';

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

  describe('Sales Channels settings navigation', () => {
    it('opens the existing POS and wholesale settings and locations workspace', () => {
      vi.mocked(SalesChannelsView).mockClear();
      const setSettingsSection = vi.fn();
      const setSettingsOpen = vi.fn();
      const setView = vi.fn();
      const props = {
        view: 'sales-channels',
        userTier: 'Admin',
        setSettingsSection,
        setSettingsOpen,
        setView,
      } as React.ComponentProps<typeof MainSections>;
      renderToStaticMarkup(<MainSections {...props} />);
      const channelProps = vi.mocked(SalesChannelsView).mock.calls[0][0];
      expect(channelProps.canManage).toBe(true);
      channelProps.onConfigureBuiltIn?.('pos');
      expect(setSettingsSection).toHaveBeenLastCalledWith('pos');
      expect(setSettingsOpen).toHaveBeenLastCalledWith(true);
      channelProps.onConfigureBuiltIn?.('wholesale');
      expect(setSettingsSection).toHaveBeenLastCalledWith('wholesale');
      channelProps.onManageLocations?.();
      expect(setView).toHaveBeenLastCalledWith('locations');
    });
  });
});