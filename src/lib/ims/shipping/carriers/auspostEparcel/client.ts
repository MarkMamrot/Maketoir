import type {
  CarrierAddress,
  CarrierCapabilities,
  CarrierParcel,
  CarrierRate,
  ShippingCarrierAdapter,
  ShippingManifestCarrierAdapter,
} from '../types';

const PRODUCTION_BASE_URL = 'https://digitalapi.auspost.com.au/shipping/v1';

export type AusPostEparcelCredentials = {
  apiKey: string;
  password: string;
  accountNumber: string;
};

export type AusPostShipmentAddress = {
  name: string;
  business_name?: string;
  lines: string[];
  suburb?: string;
  state?: string;
  postcode?: string;
  country?: string;
  phone?: string;
  email?: string;
};

export type AusPostDomesticShipment = {
  shipment_reference: string;
  customer_reference_1: string;
  customer_reference_2?: string;
  contains_s8_goods: false;
  from: AusPostShipmentAddress;
  to: AusPostShipmentAddress;
  items: Array<{
    item_reference: string;
    product_id: string;
    length: number;
    width: number;
    height: number;
    weight: number;
    authority_to_leave: false;
    allow_partial_delivery: true;
  }>;
};

export type AusPostInternationalShipment = {
  shipment_reference: string;
  customer_reference_1: string;
  customer_reference_2?: string;
  from: AusPostShipmentAddress;
  to: AusPostShipmentAddress & { country: string };
  items: Array<{
    classification_type: 'SALE_OF_GOODS' | 'GIFT' | 'SAMPLE' | 'RETURN';
    commercial_value: true;
    landed_costs_payer: 'RECEIVER_PAYS';
    item_contents: Array<{
      country_of_origin: string;
      description: string;
      sku: string;
      quantity: number;
      tariff_code: string;
      value: number;
      weight: number;
      item_contents_reference: string;
    }>;
    item_description: string;
    item_reference: string;
    length: number;
    height: number;
    width: number;
    weight: number;
    product_id: string;
  }>;
};

export type AusPostCreateShipmentsRequest = {
  shipments: Array<AusPostDomesticShipment | AusPostInternationalShipment>;
};

export type AusPostCreatedShipment = {
  shipment_id?: string;
  shipment_reference?: string;
  items?: Array<{
    item_id?: string;
    item_reference?: string;
    tracking_details?: { article_id?: string; consignment_id?: string };
  }>;
  shipment_summary?: {
    total_cost?: number;
    total_cost_ex_gst?: number;
    total_gst?: number;
  };
};

export type AusPostCreateShipmentsResponse = {
  shipments?: AusPostCreatedShipment[];
};

export type AusPostLabelRequest = {
  wait_for_label_url: boolean;
  unlabelled_articles_only: boolean;
  preferences: Array<{
    type: 'PRINT';
    format: 'PDF';
    groups: Array<{
      group: 'Parcel Post' | 'Express Post' | 'International';
      layout: 'A4-4pp' | 'A4-3pp' | 'A4-1pp';
      branded: boolean;
      left_offset: number;
      top_offset: number;
    }>;
  }>;
  shipments: Array<{ shipment_id: string }>;
};

export type AusPostLabelResponse = {
  labels?: Array<{
    request_id?: string;
    url?: string;
    status?: string;
    shipment_ids?: string[];
  }>;
};

export class AusPostApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: Array<{ code?: string; name?: string; message: string; field?: string }>,
  ) {
    super(message);
    this.name = 'AusPostApiError';
  }
}

export class AusPostEparcelClient implements ShippingCarrierAdapter<
  AusPostCreateShipmentsRequest,
  AusPostCreateShipmentsResponse,
  AusPostLabelRequest,
  AusPostLabelResponse
>, ShippingManifestCarrierAdapter {
  readonly provider = 'auspost_eparcel' as const;
  readonly capabilities: CarrierCapabilities = {
    domesticShipping: true,
    internationalShipping: true,
    addressValidation: true,
    rates: true,
    labels: ['PDF', 'ZPL'],
    manifests: true,
    voidBeforeManifest: true,
  };

  constructor(
    private readonly credentials: AusPostEparcelCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  verifyAccount(): Promise<unknown> {
    return this.request(`/accounts/${encodeURIComponent(this.credentials.accountNumber)}`);
  }

  async getRates(input: { from: CarrierAddress; to: CarrierAddress; parcels: CarrierParcel[] }): Promise<CarrierRate[][]> {
    const response = await this.request<{ items?: AusPostPriceItem[] }>('/prices/items', {
      method: 'POST',
      body: JSON.stringify({
        from: { ...toAusPostLocality(input.from), country: 'AU' },
        to: toAusPostLocality(input.to),
        items: input.parcels.map(toAusPostParcel),
      }),
    });
    return (response.items ?? []).map(item => (item.prices ?? []).map(price => ({
      serviceCode: String(price.product_id ?? ''),
      serviceName: String(price.product_type ?? price.product_id ?? ''),
      total: Number(price.calculated_price ?? 0),
      totalExGst: Number(price.calculated_price_ex_gst ?? 0),
      gst: Number(price.calculated_gst ?? 0),
      authorityToLeaveAvailable: Boolean(price.options?.authority_to_leave_option),
      signatureIncluded: Boolean(price.options?.signature_on_delivery_option),
    })));
  }

  createDomesticShipments(input: AusPostCreateShipmentsRequest): Promise<AusPostCreateShipmentsResponse> {
    return this.request('/shipments', { method: 'POST', body: JSON.stringify(input) });
  }

  createInternationalShipments(input: AusPostCreateShipmentsRequest): Promise<AusPostCreateShipmentsResponse> {
    return this.request('/shipments', { method: 'POST', body: JSON.stringify(input) });
  }

  createLabels(input: AusPostLabelRequest): Promise<AusPostLabelResponse> {
    return this.request('/labels', { method: 'POST', body: JSON.stringify(input) });
  }

  getLabel(requestId: string): Promise<AusPostLabelResponse> {
    return this.request(`/labels/${encodeURIComponent(requestId)}`);
  }

  deleteShipment(shipmentId: string): Promise<unknown> {
    return this.request(`/shipments/${encodeURIComponent(shipmentId)}`, { method: 'DELETE' });
  }

  async createOrderFromShipments(input: { orderReference: string; shipmentIds: string[] }): Promise<{ orderId: string }> {
    const payload = await this.request<AusPostOrderResponse>('/orders', {
      method: 'PUT',
      body: JSON.stringify({
        order_reference: input.orderReference.slice(0, 50),
        payment_method: 'CHARGE_TO_ACCOUNT',
        shipments: input.shipmentIds.map(shipmentId => ({ shipment_id: shipmentId })),
      }),
    });
    const orderId = String(payload.order?.order_id ?? '').trim();
    if (!orderId) throw new Error('Australia Post did not return an order ID.');
    return { orderId };
  }

  async getOrder(orderId: string): Promise<{ orderId: string; shipmentIds: string[] }> {
    const payload = await this.request<AusPostOrderResponse>(`/orders/${encodeURIComponent(orderId)}`);
    const order = payload.order;
    const returnedOrderId = String(order?.order_id ?? '').trim();
    if (!returnedOrderId) throw new Error('Australia Post did not return the requested order.');
    return {
      orderId: returnedOrderId,
      shipmentIds: (order?.shipments ?? []).map(shipment => String(shipment.shipment_id ?? '').trim()).filter(Boolean),
    };
  }

  async getOrderSummaryPdf(orderId: string): Promise<Uint8Array> {
    const path = `/accounts/${encodeURIComponent(this.credentials.accountNumber)}/orders/${encodeURIComponent(orderId)}/summary`;
    const response = await this.fetchImpl(`${PRODUCTION_BASE_URL}${path}`, {
      headers: this.headers({ Accept: 'application/pdf' }),
    });
    if (!response.ok) {
      const payload = await parseResponse(response);
      const errors = normalizeAusPostErrors(payload);
      throw new AusPostApiError(
        errors.map(error => error.message).join(' ') || `Australia Post request failed with HTTP ${response.status}.`,
        response.status,
        errors,
      );
    }
    if (!String(response.headers.get('content-type') ?? '').toLowerCase().includes('application/pdf')) {
      throw new Error('Australia Post did not return a PDF order summary.');
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${PRODUCTION_BASE_URL}${path}`, {
      ...init,
      headers: this.headers({ Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }),
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      const errors = normalizeAusPostErrors(payload);
      throw new AusPostApiError(
        errors.map(error => error.message).join(' ') || `Australia Post request failed with HTTP ${response.status}.`,
        response.status,
        errors,
      );
    }
    return payload as T;
  }

  private headers(extra: HeadersInit = {}): HeadersInit {
    return {
      Authorization: `Basic ${Buffer.from(`${this.credentials.apiKey}:${this.credentials.password}`).toString('base64')}`,
      'account-number': this.credentials.accountNumber,
      ...extra,
    };
  }
}

type AusPostOrderResponse = {
  order?: {
    order_id?: string;
    shipments?: Array<{ shipment_id?: string }>;
  };
};

type AusPostPriceItem = {
  prices?: Array<{
    product_id?: string;
    product_type?: string;
    calculated_price?: number;
    calculated_price_ex_gst?: number;
    calculated_gst?: number;
    options?: {
      authority_to_leave_option?: boolean;
      signature_on_delivery_option?: boolean;
    };
  }>;
};

function toAusPostLocality(address: CarrierAddress): Record<string, string> {
  return {
    ...(address.postcode ? { postcode: address.postcode } : {}),
    ...(address.suburb ? { suburb: address.suburb } : {}),
    country: normalizeAusPostCountry(address.country),
  };
}

function normalizeAusPostCountry(country: string): string {
  const normalized = country.trim().toUpperCase();
  return !normalized || normalized === 'AUSTRALIA' || normalized === 'AUS' ? 'AU' : normalized;
}

function toAusPostParcel(parcel: CarrierParcel): Record<string, string | number> {
  return {
    item_reference: parcel.reference.slice(0, 50),
    length: millimetresToCentimetres(parcel.lengthMm),
    width: millimetresToCentimetres(parcel.widthMm),
    height: millimetresToCentimetres(parcel.heightMm),
    weight: parcel.weightKg,
    ...(parcel.packageType ? { packaging_type: parcel.packageType } : {}),
  };
}

function millimetresToCentimetres(value: number): number {
  return Math.round((value / 10) * 10) / 10;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { errors: [{ message: `Australia Post returned an unreadable response (HTTP ${response.status}).` }] };
  }
}

function normalizeAusPostErrors(payload: unknown): Array<{ code?: string; name?: string; message: string; field?: string }> {
  if (!payload || typeof payload !== 'object') return [];
  const rawErrors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(rawErrors)) return [];
  return rawErrors.map(raw => {
    const error = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      code: stringOrUndefined(error.code ?? error.error_code),
      name: stringOrUndefined(error.name ?? error.error_name),
      message: stringOrUndefined(error.message) ?? 'Australia Post rejected the request.',
      field: stringOrUndefined(error.field),
    };
  });
}

function stringOrUndefined(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}
