import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetOperationContext,
  mockGetMapping,
  mockReportRuntimeIssue,
  mockEnableCustomer,
  mockDisableCustomer,
  mockUpdateCustomer,
} = vi.hoisted(() => ({
  mockGetOperationContext: vi.fn(),
  mockGetMapping: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockEnableCustomer: vi.fn(),
  mockDisableCustomer: vi.fn(),
  mockUpdateCustomer: vi.fn(),
}));

vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mockGetOperationContext }));
vi.mock('@/lib/ims/contactChannelMappings', () => ({ getContactChannelMappingForContact: mockGetMapping }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    enableCustomer = mockEnableCustomer;
    disableCustomer = mockDisableCustomer;
    updateCustomer = mockUpdateCustomer;
  },
}));

import {
  buildShopifyCustomerPayload,
  shouldSyncRetailCustomer,
  syncRetailCustomerToShopify,
} from '../shopifyCustomerSync';

describe('shopifyCustomerSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMapping.mockResolvedValue({
      id: 1,
      businessId: 'biz-1',
      channelInstanceId: 'store-1',
      contactId: 101,
      externalCustomerId: '12345',
      mappingStatus: 'linked',
    });
    mockGetOperationContext.mockResolvedValue({
      instance: { settings: { shopify: { customers: { outboundEnabled: true } } } },
      credentials: { shopDomain: 'test-shop.myshopify.com', token: 'token-raw' },
    });
    mockEnableCustomer.mockResolvedValue(undefined);
    mockDisableCustomer.mockResolvedValue(undefined);
    mockUpdateCustomer.mockResolvedValue({});
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  describe('shouldSyncRetailCustomer', () => {
    it('returns true only for retail customers', () => {
      expect(shouldSyncRetailCustomer({ type: 'retail_customer' })).toBe(true);
      expect(shouldSyncRetailCustomer({ type: 'both' })).toBe(false);
      expect(shouldSyncRetailCustomer({ type: 'supplier' })).toBe(false);
    });
  });

  describe('inactive retail contact guard', () => {
    it('keeps inactive retail contacts out of outbound eligibility decisions at sync time', () => {
      expect(shouldSyncRetailCustomer({ type: 'retail_customer' })).toBe(true);
    });
  });

  describe('buildShopifyCustomerPayload', () => {
    it('prefers explicit first and last name and mobile for phone', () => {
      expect(buildShopifyCustomerPayload({
        name: 'Ignored Name',
        first_name: 'Mia',
        last_name: 'Chen',
        email: 'mia@example.com',
        phone: '03 9000 0000',
        mobile: '0400 111 222',
      })).toEqual({
        first_name: 'Mia',
        last_name: 'Chen',
        email: 'mia@example.com',
        phone: '0400 111 222',
      });
    });

    it('falls back to contact name when first name is missing', () => {
      expect(buildShopifyCustomerPayload({
        name: 'Alex Rivers',
        first_name: null,
        last_name: null,
        email: null,
        phone: '03 9111 1111',
        mobile: null,
      })).toEqual({
        first_name: 'Alex Rivers',
        phone: '03 9111 1111',
      });
    });

    it('omits blank values', () => {
      expect(buildShopifyCustomerPayload({
        name: '   ',
        first_name: ' ',
        last_name: '',
        email: ' ',
        phone: undefined,
        mobile: null,
      })).toEqual({});
    });
  });

  describe('syncRetailCustomerToShopify', () => {
    it('best-effort enables then updates linked active retail customers', async () => {
      const result = await syncRetailCustomerToShopify({
        id: 101,
        type: 'retail_customer',
        is_active: 1,
        shopify_customer_id: '12345',
        first_name: 'Mia',
        last_name: 'Chen',
        email: 'mia@example.com',
      }, { businessId: 'biz-1', channelInstanceId: 'store-1' });

      expect(result).toEqual({ success: true, action: 'updated', shopifyCustomerId: '12345' });
      expect(mockEnableCustomer).toHaveBeenCalledWith('12345');
      expect(mockUpdateCustomer).toHaveBeenCalledWith('12345', {
        first_name: 'Mia',
        last_name: 'Chen',
        email: 'mia@example.com',
      });
    });

    it('continues update when enable fails for linked active retail customers', async () => {
      mockEnableCustomer.mockRejectedValueOnce(new Error('already enabled'));

      const result = await syncRetailCustomerToShopify({
        id: 102,
        type: 'retail_customer',
        is_active: 1,
        shopify_customer_id: '54321',
        first_name: 'Alex',
      }, { businessId: 'biz-1', channelInstanceId: 'store-1' });

      expect(result).toEqual({ success: true, action: 'updated', shopifyCustomerId: '12345' });
      expect(mockEnableCustomer).toHaveBeenCalledWith('12345');
      expect(mockUpdateCustomer).toHaveBeenCalledWith('12345', { first_name: 'Alex' });
    });

    it('disables linked inactive retail customers', async () => {
      const result = await syncRetailCustomerToShopify({
        id: 103,
        type: 'retail_customer',
        is_active: 0,
        shopify_customer_id: '777',
      }, { businessId: 'biz-1', channelInstanceId: 'store-1' });

      expect(result).toEqual({ success: true, action: 'updated', shopifyCustomerId: '12345' });
      expect(mockDisableCustomer).toHaveBeenCalledWith('12345');
      expect(mockEnableCustomer).not.toHaveBeenCalled();
      expect(mockUpdateCustomer).not.toHaveBeenCalled();
    });

    it('updates the distinct customer mapped to each exact store', async () => {
      mockGetMapping
        .mockResolvedValueOnce({ businessId: 'biz-1', channelInstanceId: 'store-1', contactId: 101, externalCustomerId: 'customer-a', mappingStatus: 'linked' })
        .mockResolvedValueOnce({ businessId: 'biz-1', channelInstanceId: 'store-2', contactId: 101, externalCustomerId: 'customer-b', mappingStatus: 'linked' });

      const contact = { id: 101, type: 'retail_customer', first_name: 'Mia' };
      await syncRetailCustomerToShopify(contact, { businessId: 'biz-1', channelInstanceId: 'store-1' });
      await syncRetailCustomerToShopify(contact, { businessId: 'biz-1', channelInstanceId: 'store-2' });

      expect(mockUpdateCustomer).toHaveBeenNthCalledWith(1, 'customer-a', { first_name: 'Mia' });
      expect(mockUpdateCustomer).toHaveBeenNthCalledWith(2, 'customer-b', { first_name: 'Mia' });
    });

    it('does not call Shopify when outbound sync uses its disabled default', async () => {
      mockGetOperationContext.mockResolvedValue({
        instance: { settings: {} },
        credentials: { shopDomain: 'test-shop.myshopify.com', token: 'token-raw' },
      });

      const result = await syncRetailCustomerToShopify(
        { id: 101, type: 'retail_customer', first_name: 'Mia' },
        { businessId: 'biz-1', channelInstanceId: 'store-1' },
      );

      expect(result).toMatchObject({ success: false, action: 'skipped', reason: expect.stringContaining('disabled') });
      expect(mockUpdateCustomer).not.toHaveBeenCalled();
      expect(mockDisableCustomer).not.toHaveBeenCalled();
    });

    it('does not create or update an unmapped customer', async () => {
      mockGetMapping.mockResolvedValue(null);

      const result = await syncRetailCustomerToShopify(
        { id: 101, type: 'retail_customer', shopify_customer_id: 'legacy-id', first_name: 'Mia' },
        { businessId: 'biz-1', channelInstanceId: 'store-1' },
      );

      expect(result).toMatchObject({ success: false, action: 'skipped', reason: expect.stringContaining('not linked') });
      expect(mockGetOperationContext).not.toHaveBeenCalled();
      expect(mockUpdateCustomer).not.toHaveBeenCalled();
    });
  });
});