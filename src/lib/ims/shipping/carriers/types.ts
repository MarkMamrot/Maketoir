import type { ShippingProvider } from '../types';

export type CarrierAddress = {
  name: string;
  businessName?: string;
  lines: string[];
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  phone?: string;
  email?: string;
};

export type CarrierParcel = {
  reference: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightKg: number;
  packageType?: string;
};

export type CarrierRate = {
  serviceCode: string;
  serviceName: string;
  total: number;
  totalExGst: number;
  gst: number;
  authorityToLeaveAvailable: boolean;
  signatureIncluded: boolean;
};

export type CarrierLabelFormat = 'PDF' | 'ZPL';

export type CarrierCapabilities = {
  domesticShipping: boolean;
  internationalShipping: boolean;
  addressValidation: boolean;
  rates: boolean;
  labels: readonly CarrierLabelFormat[];
  manifests: boolean;
  voidBeforeManifest: boolean;
};

export interface ShippingCarrierAdapter<
  ShipmentRequest = unknown,
  ShipmentResponse = unknown,
  LabelRequest = unknown,
  LabelResponse = unknown,
> {
  readonly provider: ShippingProvider;
  readonly capabilities: CarrierCapabilities;
  verifyAccount(): Promise<unknown>;
  getRates(input: { from: CarrierAddress; to: CarrierAddress; parcels: CarrierParcel[] }): Promise<CarrierRate[][]>;
  createDomesticShipments(input: ShipmentRequest): Promise<ShipmentResponse>;
  createInternationalShipments(input: ShipmentRequest): Promise<ShipmentResponse>;
  createLabels(input: LabelRequest): Promise<LabelResponse>;
  getLabel(requestId: string): Promise<LabelResponse>;
}

export interface ShippingManifestCarrierAdapter {
  createOrderFromShipments(input: { orderReference: string; shipmentIds: string[] }): Promise<{ orderId: string }>;
  getOrder(orderId: string): Promise<{ orderId: string; shipmentIds: string[] }>;
  getOrderSummaryPdf(orderId: string): Promise<Uint8Array>;
}
