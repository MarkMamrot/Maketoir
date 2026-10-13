import type { CustomsSnapshot, NonSaleDeclaredValueInput, ShippingExportPurpose } from './customs';
import type { ShippingQuote } from './shippingQuotes';

export type ShippingAmendmentRecipient = {
  name: string; lines: string[]; suburb: string; state: string; postcode: string;
  country: string; email: string; phone: string;
};
export type ShippingAmendmentParcel = {
  parcelId?: number; providerItemId?: string | null; packagePresetId?: number | null;
  packageType: string; parcelNumber: number; lengthMm: number; widthMm: number;
  heightMm: number; weightKg: number; allocations: { soItemId: number; quantity: number }[];
};
export type ShippingAmendmentDraft = {
  carrierAccountId: number | null; recipient: ShippingAmendmentRecipient; parcels: ShippingAmendmentParcel[];
  exportPurpose?: ShippingExportPurpose; nonSaleValues?: NonSaleDeclaredValueInput[];
  nonSaleValuesConfirmed?: boolean;
};
export type ShippingAmendmentInput = ShippingAmendmentDraft & {
  operationKey: string; expectedRevision: number; expectedUpdatedAt: string;
  service: ShippingQuote; confirmCarrierUpdate?: boolean;
};
export type ShippingEditableOrderItem = {
  id: number; sku: string; product_name: string; notes: string | null; product_id: string | null;
  qty_ordered: number; qty_fulfilled: number; unit_price: number; discount_pct: number; tax_rate: number;
  customs_description: string | null; hs_code: string | null; country_of_origin: string | null;
  is_dangerous_or_restricted: boolean; weight_kg: number | null;
};
export type ShippingEditableDetail = {
  shipmentId: number; revision: number; updatedAt: string; status: string; soId: number;
  soNumber: string; carrierAccountId: number | null; providerShipmentId: string | null;
  isInternational: boolean; editEligibility: { eligible: boolean; reason?: string };
  carrierUpdateEnabled: boolean; recipient: ShippingAmendmentRecipient; service: ShippingQuote | null;
  chargedCost: number | null;
  parcels: ShippingAmendmentParcel[]; customs: CustomsSnapshot | null;
  order: {
    id: number; so_number: string; status: string; so_type: string | null; tax_treatment: string;
    customer_name: string; customer_email: string | null; customer_phone: string | null;
    contact_id: number | null; delivery_address: string | null; delivery_address2: string | null;
    delivery_suburb: string | null; delivery_city: string | null; delivery_state: string | null;
    delivery_postcode: string | null; delivery_country: string | null; items: ShippingEditableOrderItem[];
  };
};
export type ShippingAmendmentResult = {
  shipment: ShippingEditableDetail; affectedShipmentIds: number[]; requiresFreshLabels: boolean;
};
