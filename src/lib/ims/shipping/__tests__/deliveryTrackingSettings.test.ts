import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELIVERY_TRACKING_CHANNELS, enabledDeliveryTrackingChannels, validateDeliveryTrackingChannels,
  validateDeliveryTrackingSettingsReport, validateDeliveryTrackingSettingsRequest,
} from '../deliveryTrackingSettings';

describe('delivery tracking channel policy', () => {
  it('defaults only Amazon On and accepts all types Off', () => {
    expect(enabledDeliveryTrackingChannels({ ...DEFAULT_DELIVERY_TRACKING_CHANNELS })).toEqual(['amazon']);
    expect(enabledDeliveryTrackingChannels({ amazon: false, shopify: false, native_shop: false })).toEqual([]);
  });
  it('allows every supported online type independently', () => {
    expect(enabledDeliveryTrackingChannels({ amazon: false, shopify: true, native_shop: true })).toEqual(['shopify', 'native_shop']);
  });
  it.each([
    null, [], true, {}, { amazon: true }, { amazon: 'true', shopify: false, native_shop: false },
    { amazon: 1, shopify: false, native_shop: false }, { amazon: true, shopify: false, native_shop: false, retail: true },
  ])('rejects malformed, partial or unsupported channel settings: %j', input => {
    expect(() => validateDeliveryTrackingChannels(input)).toThrow('every supported online channel type');
  });
  it('returns an independent, field-whitelisted settings object', () => {
    const result = validateDeliveryTrackingChannels(DEFAULT_DELIVERY_TRACKING_CHANNELS);
    result.amazon = false;
    expect(DEFAULT_DELIVERY_TRACKING_CHANNELS.amazon).toBe(true);
  });
  it('requires expected business scope but rejects caller-supplied tenant or actor overrides', () => {
    const request = { expectedBusinessId: 'tenant-a', channels: DEFAULT_DELIVERY_TRACKING_CHANNELS };
    expect(validateDeliveryTrackingSettingsRequest(request)).toEqual(request);
    for (const invalid of [{ channels: request.channels }, { ...request, businessId: 'tenant-b' }, { ...request, actorUserId: 99 }]) {
      expect(() => validateDeliveryTrackingSettingsRequest(invalid)).toThrow();
    }
  });
  it('never turns failed or incomplete responses into defaults', () => {
    const report = { success: true, businessId: 'tenant-a', channels: DEFAULT_DELIVERY_TRACKING_CHANNELS, readOnly: false };
    expect(validateDeliveryTrackingSettingsReport(report)).toEqual({ businessId: 'tenant-a', channels: report.channels, readOnly: false });
    for (const invalid of [{ ...report, success: false }, { ...report, readOnly: undefined }, { ...report, channels: {} }]) {
      expect(() => validateDeliveryTrackingSettingsReport(invalid)).toThrow();
    }
  });
});
