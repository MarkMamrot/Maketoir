import { getImsDbNameStrict } from '@/lib/db/BusinessRegistry';
import { OnlineSalesChannelRepository } from '@/lib/onlineShop/onlineShopProfile';
import type { OnlineChannelCapabilities } from '@/lib/storefront/channel';
import { imsQuery } from '@/services/IMSMySQLService';

export const ACCOUNTING_CONNECTION_SETTING = 'connect_accounting_software';
export const ACCOUNTING_PLATFORM_SETTING = 'accounting_software';

export function resolveXeroAccountingEnabled(settings: Record<string, string | null | undefined>): boolean {
  return settings[ACCOUNTING_CONNECTION_SETTING] === 'yes'
    && settings[ACCOUNTING_PLATFORM_SETTING] === 'xero';
}

export async function isXeroAccountingEnabled(businessId: string): Promise<boolean> {
  const imsDbName = await getImsDbNameStrict(businessId);
  if (!imsDbName) {
    throw new Error(`Tenant isolation: no IMS database mapping found for business ${businessId}.`);
  }

  const rows = await imsQuery<{ key: string; value: string | null }>(
    'SELECT `key`, `value` FROM ims_settings WHERE business_id = ? AND `key` IN (?, ?)',
    [businessId, ACCOUNTING_CONNECTION_SETTING, ACCOUNTING_PLATFORM_SETTING],
    imsDbName,
  );
  return resolveXeroAccountingEnabled(Object.fromEntries(rows.map(row => [row.key, row.value])));
}

export class XeroAccountingDisabledError extends Error {
  readonly code = 'xero_accounting_disabled';
  readonly status = 423;

  constructor() {
    super('Accounting software is disabled for this business.');
    this.name = 'XeroAccountingDisabledError';
  }
}

export async function assertXeroAccountingEnabled(businessId: string): Promise<void> {
  if (!await isXeroAccountingEnabled(businessId)) throw new XeroAccountingDisabledError();
}

export function isXeroAccountingDisabledError(error: unknown): error is XeroAccountingDisabledError {
  return error instanceof XeroAccountingDisabledError;
}

export async function getOnlineChannelCapabilities(businessId: string): Promise<OnlineChannelCapabilities> {
  if (!businessId.trim()) return { shopifyEnabled: false, nativeShopEnabled: false };
  return OnlineSalesChannelRepository.getCapabilities(businessId);
}

export async function setOnlineChannelCapabilities(input: OnlineChannelCapabilities & {
  businessId: string;
  actorUserId?: number | null;
  actorName?: string | null;
}): Promise<void> {
  await OnlineSalesChannelRepository.setCapabilities(input);
}

export class OnlineChannelDisabledError extends Error {
  readonly status = 403;

  constructor(readonly channel: 'shopify' | 'native_shop') {
    super(channel === 'shopify'
      ? 'Shopify is disabled for this business.'
      : 'Solvantis Online Store is disabled for this business.');
    this.name = 'OnlineChannelDisabledError';
  }

  get code(): 'shopify_disabled' | 'native_shop_disabled' {
    return this.channel === 'shopify' ? 'shopify_disabled' : 'native_shop_disabled';
  }
}

export async function assertShopifyEnabled(businessId: string): Promise<void> {
  if (!(await getOnlineChannelCapabilities(businessId)).shopifyEnabled) {
    throw new OnlineChannelDisabledError('shopify');
  }
}

export async function assertNativeShopEnabled(businessId: string): Promise<void> {
  if (!(await getOnlineChannelCapabilities(businessId)).nativeShopEnabled) {
    throw new OnlineChannelDisabledError('native_shop');
  }
}

export function isOnlineChannelDisabledError(error: unknown): error is OnlineChannelDisabledError {
  return error instanceof OnlineChannelDisabledError;
}