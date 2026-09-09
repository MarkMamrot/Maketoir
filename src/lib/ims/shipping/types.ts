import type { SOStatus } from '../orderLifecyclePolicy';

export const SHIPPING_PROVIDERS = ['auspost_eparcel', 'mypost_business'] as const;
export type ShippingProvider = typeof SHIPPING_PROVIDERS[number];

export const SHIPPING_SHIPMENT_STATUSES = [
  'draft',
  'quoting',
  'submitting',
  'submission_unknown',
  'carrier_created',
  'label_submitting',
  'label_pending',
  'label_unknown',
  'label_ready',
  'ims_fulfilled',
  'channel_pending',
  'complete',
  'failed',
  'voided',
  'manifested',
] as const;
export type ShippingShipmentStatus = typeof SHIPPING_SHIPMENT_STATUSES[number];

export type ShippingOrderEligibilityInput = {
  status: SOStatus;
  soType?: string | null;
  salesChannel?: string | null;
  channelDeliveryType?: string | null;
  isPosLedger?: boolean;
  remainingQuantity: number;
};

export type ShippingOrderEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

export type ShippingParcelAllocation = {
  soItemId: number;
  quantity: number;
};

export type ShippingOrderLine = {
  soItemId: number;
  remainingQuantity: number;
};

export type ShippingParcelDraft = {
  parcelNumber: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightKg: number;
  allocations: ShippingParcelAllocation[];
};