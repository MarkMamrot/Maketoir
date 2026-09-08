import type {
  CarrierAddress,
  CarrierCapabilities,
  CarrierParcel,
  CarrierRate,
  ShippingCarrierAdapter,
} from '../types';

const PRODUCTION_BASE_URL = 'https://digitalapi.auspost.com.au/shipping/v1';

export type AusPostEparcelCredentials = {
  apiKey: string;
  password: string;
  accountNumber: string;
  baseUrl?: string;
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

export class AusPostEparcelClient implements ShippingCarrierAdapter {
  readonly provider = 'auspost_eparcel' as const;
  readonly capabilities: CarrierCapabilities = {
    domesticShipping: true,
    internationalShipping: false,
    addressValidation: true,
    rates: true,
    labels: ['PDF', 'ZPL'],
    manifests: true,
    voidBeforeManifest: true,
  };

  private readonly baseUrl: string;

  constructor(
    private readonly credentials: AusPostEparcelCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = (credentials.baseUrl || PRODUCTION_BASE_URL).replace(/\/+$/, '');
  }

  verifyAccount(): Promise<unknown> {
    return this.request(`/accounts/${encodeURIComponent(this.credentials.accountNumber)}`);
  }

  async getRates(input: { from: CarrierAddress; to: CarrierAddress; parcels: CarrierParcel[] }): Promise<CarrierRate[][]> {
    const response = await this.request<{ items?: AusPostPriceItem[] }>('/prices/items', {
      method: 'POST',
      body: JSON.stringify({
        from: toAusPostLocality(input.from),
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

  createDomesticShipments(input: unknown): Promise<unknown> {
    return this.request('/shipments', { method: 'POST', body: JSON.stringify(input) });
  }

  createLabels(input: unknown): Promise<unknown> {
    return this.request('/labels', { method: 'POST', body: JSON.stringify(input) });
  }

  getLabel(requestId: string): Promise<unknown> {
    return this.request(`/labels/${encodeURIComponent(requestId)}`);
  }

  deleteShipment(shipmentId: string): Promise<unknown> {
    return this.request(`/shipments/${encodeURIComponent(shipmentId)}`, { method: 'DELETE' });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.credentials.apiKey}:${this.credentials.password}`).toString('base64')}`,
        'account-number': this.credentials.accountNumber,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
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
}

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
    postcode: address.postcode,
    suburb: address.suburb,
    country: address.country || 'AU',
  };
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
