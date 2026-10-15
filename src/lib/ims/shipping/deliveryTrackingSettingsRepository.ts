import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import {
  DEFAULT_DELIVERY_TRACKING_CHANNELS, DeliveryTrackingSettingsValidationError,
  validateDeliveryTrackingChannels, type DeliveryTrackingChannels,
} from './deliveryTrackingSettings';

export const DELIVERY_TRACKING_CHANNELS_KEY = 'shipping_delivery_tracking_channels';

export async function getDeliveryTrackingChannels(businessId: string): Promise<DeliveryTrackingChannels> {
  if (!businessId) throw new Error('A business scope is required for delivery tracking settings.');
  return runImsForBusiness(businessId, async () => {
    const rows = await imsQuery<{ value: string }>(
      'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ?',
      [businessId, DELIVERY_TRACKING_CHANNELS_KEY],
    );
    if (!rows.length) return { ...DEFAULT_DELIVERY_TRACKING_CHANNELS };
    if (rows.length !== 1) throw new Error('Delivery tracking settings have conflicting saved records.');
    try {
      return validateDeliveryTrackingChannels(JSON.parse(rows[0].value));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof DeliveryTrackingSettingsValidationError) {
        throw new Error('Saved delivery tracking settings are invalid. Correct them in Settings > Shipping before polling.');
      }
      throw error;
    }
  });
}

export async function saveDeliveryTrackingChannels(businessId: string, input: DeliveryTrackingChannels): Promise<void> {
  if (!businessId) throw new Error('A business scope is required for delivery tracking settings.');
  const channels = validateDeliveryTrackingChannels(input);
  await runImsForBusiness(businessId, async () => {
    await imsExecute(
      'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [businessId, DELIVERY_TRACKING_CHANNELS_KEY, JSON.stringify(channels)],
    );
  });
}
