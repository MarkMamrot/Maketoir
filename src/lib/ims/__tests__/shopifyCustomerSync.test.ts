import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetConnection,
  mockDecrypt,
  mockImsExecute,
  mockEnableCustomer,
  mockDisableCustomer,
  mockUpdateCustomer,
  mockFindCustomerByEmail,
  mockCreateCustomer,
} = vi.hoisted(() => ({
  mockGetConnection: vi.fn(),
  mockDecrypt: vi.fn((value: string) => value),
  mockImsExecute: vi.fn(),
  mockEnableCustomer: vi.fn(),
  mockDisableCustomer: vi.fn(),
  mockUpdateCustomer: vi.fn(),
  mockFindCustomerByEmail: vi.fn(),
  mockCreateCustomer: vi.fn(),
}));

vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: {
    get: mockGetConnection,
  },
}));

vi.mock('@/lib/encryption', () => ({
  decrypt: mockDecrypt,
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsExecute: mockImsExecute,
}));

vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    enableCustomer = mockEnableCustomer;
    disableCustomer = mockDisableCustomer;
    updateCustomer = mockUpdateCustomer;
    findCustomerByEmail = mockFindCustomerByEmail;
    createCustomer = mockCreateCustomer;
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
    mockGetConnection.mockResolvedValue({
      shopify_shop_id: 'test-shop',
      shopify_access_token: 'token-raw',
    });
    mockEnableCustomer.mockResolvedValue(undefined);
    mockDisableCustomer.mockResolvedValue(undefined);
    mockUpdateCustomer.mockResolvedValue({});
    mockFindCustomerByEmail.mockResolvedValue(null);
    mockCreateCustomer.mockResolvedValue({ id: 999 });
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
      }, 'biz-1');

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
      }, 'biz-1');

      expect(result).toEqual({ success: true, action: 'updated', shopifyCustomerId: '54321' });
      expect(mockEnableCustomer).toHaveBeenCalledWith('54321');
      expect(mockUpdateCustomer).toHaveBeenCalledWith('54321', { first_name: 'Alex' });
    });

    it('disables linked inactive retail customers', async () => {
      const result = await syncRetailCustomerToShopify({
        id: 103,
        type: 'retail_customer',
        is_active: 0,
        shopify_customer_id: '777',
      }, 'biz-1');

      expect(result).toEqual({ success: true, action: 'updated', shopifyCustomerId: '777' });
      expect(mockDisableCustomer).toHaveBeenCalledWith('777');
      expect(mockEnableCustomer).not.toHaveBeenCalled();
      expect(mockUpdateCustomer).not.toHaveBeenCalled();
    });
  });
});