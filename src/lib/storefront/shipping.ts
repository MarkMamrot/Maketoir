export interface StorefrontShippingAddress {
  address: string;
  address2?: string;
  suburb: string;
  city?: string;
  state: string;
  postcode: string;
  country: string;
}

export interface StorefrontShippingLine {
  variantId: string;
  quantity: number;
  lineTotalMinor: number;
  weightGrams?: number;
}

export interface StorefrontShippingQuoteRequest {
  businessId: string;
  currency: 'AUD';
  destination: StorefrontShippingAddress;
  lines: StorefrontShippingLine[];
}

export interface StorefrontShippingOption {
  id: string;
  provider: string;
  type: 'delivery' | 'pickup';
  label: string;
  description?: string;
  amountMinor: number;
  currency: 'AUD';
  locationId?: number;
}

export interface StorefrontShippingProvider {
  readonly id: string;
  quote(request: StorefrontShippingQuoteRequest): Promise<StorefrontShippingOption[]>;
}