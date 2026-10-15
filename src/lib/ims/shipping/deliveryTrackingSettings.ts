import { SALES_CHANNEL_PROVIDERS, type SalesChannelProvider } from '@/lib/channels/types';

export type DeliveryTrackingChannels = Record<SalesChannelProvider, boolean>;
export const DEFAULT_DELIVERY_TRACKING_CHANNELS: Readonly<DeliveryTrackingChannels> = Object.freeze({
  amazon: true, shopify: false, native_shop: false,
});

export class DeliveryTrackingSettingsValidationError extends Error {}

export function validateDeliveryTrackingChannels(value: unknown): DeliveryTrackingChannels {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== SALES_CHANNEL_PROVIDERS.length
    || Object.keys(value).some(key => !SALES_CHANNEL_PROVIDERS.some(provider => provider === key))
    || !('amazon' in value) || typeof value.amazon !== 'boolean'
    || !('shopify' in value) || typeof value.shopify !== 'boolean'
    || !('native_shop' in value) || typeof value.native_shop !== 'boolean') {
    throw new DeliveryTrackingSettingsValidationError('Choose On or Off for every supported online channel type.');
  }
  return { amazon: value.amazon, shopify: value.shopify, native_shop: value.native_shop };
}

export function enabledDeliveryTrackingChannels(channels: DeliveryTrackingChannels): SalesChannelProvider[] {
  return SALES_CHANNEL_PROVIDERS.filter(provider => channels[provider]);
}

export function validateDeliveryTrackingSettingsRequest(value: unknown): {
  expectedBusinessId: string; channels: DeliveryTrackingChannels;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['expectedBusinessId', 'channels'].includes(key))
    || !('expectedBusinessId' in value) || typeof value.expectedBusinessId !== 'string' || !value.expectedBusinessId.trim()
    || !('channels' in value)) {
    throw new DeliveryTrackingSettingsValidationError('Reload delivery tracking settings and submit the supported channel switches.');
  }
  return { expectedBusinessId: value.expectedBusinessId, channels: validateDeliveryTrackingChannels(value.channels) };
}

export interface DeliveryTrackingSettingsReport {
  businessId: string; channels: DeliveryTrackingChannels; readOnly: boolean;
}

export function validateDeliveryTrackingSettingsReport(value: unknown): DeliveryTrackingSettingsReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !('success' in value) || value.success !== true
    || !('businessId' in value) || typeof value.businessId !== 'string' || !value.businessId
    || !('readOnly' in value) || typeof value.readOnly !== 'boolean' || !('channels' in value)) {
    throw new Error('Delivery tracking settings could not be confirmed. Reload saved settings.');
  }
  return { businessId: value.businessId, readOnly: value.readOnly, channels: validateDeliveryTrackingChannels(value.channels) };
}
