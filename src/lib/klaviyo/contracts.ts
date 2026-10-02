import type { KlaviyoEventInput, KlaviyoEventProfile } from '@/services/KlaviyoService';

export const KLAVIYO_COMMERCE_EVENT_VERSION = 1;

export interface KlaviyoIntegrationSettings {
  enabled: boolean;
  profilesEnabled: boolean;
  reportingEnabled: boolean;
  sources: {
    pos: boolean;
    nativeShop: boolean;
    wholesale: boolean;
    shopify: boolean;
  };
  shopifyDuplicateRiskAcknowledged: boolean;
}

export const DEFAULT_KLAVIYO_INTEGRATION_SETTINGS: KlaviyoIntegrationSettings = {
  enabled: false,
  profilesEnabled: false,
  reportingEnabled: false,
  sources: {
    pos: false,
    nativeShop: false,
    wholesale: false,
    shopify: false,
  },
  shopifyDuplicateRiskAcknowledged: false,
};

export type KlaviyoContactType = 'supplier' | 'b2b_customer' | 'retail_customer' | 'lead' | 'both';

export interface KlaviyoContactIdentityInput {
  businessId: string;
  contactId: number;
  contactType: KlaviyoContactType;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
}

export interface KlaviyoContactIdentity {
  eligible: boolean;
  reason: 'eligible' | 'unsupported_contact_type' | 'invalid_identity';
  profile: KlaviyoEventProfile | null;
}

export interface KlaviyoOrderLineInput {
  lineId: string;
  productId?: string | null;
  variantId?: string | null;
  sku?: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineValue: number;
}

export interface KlaviyoPlacedOrderInput {
  profile: KlaviyoEventProfile;
  source: keyof KlaviyoIntegrationSettings['sources'];
  orderId: string;
  occurredAt: string;
  totalValue: number;
  currency?: string;
  locationId?: string | number | null;
  backfill?: boolean;
  lines: KlaviyoOrderLineInput[];
}

function bool(value: unknown): boolean {
  return value === true;
}

export function parseKlaviyoIntegrationSettings(value: unknown): KlaviyoIntegrationSettings {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sources = settings.sources && typeof settings.sources === 'object'
    ? settings.sources as Record<string, unknown>
    : {};
  return {
    enabled: bool(settings.enabled),
    profilesEnabled: bool(settings.profilesEnabled),
    reportingEnabled: bool(settings.reportingEnabled),
    sources: {
      pos: bool(sources.pos),
      nativeShop: bool(sources.nativeShop),
      wholesale: bool(sources.wholesale),
      shopify: bool(sources.shopify),
    },
    shopifyDuplicateRiskAcknowledged: bool(settings.shopifyDuplicateRiskAcknowledged),
  };
}

export function normalizeKlaviyoEmail(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

export function normalizeKlaviyoPhone(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const digits = trimmed.replace(/\D/g, '');
  const normalized = trimmed.startsWith('+')
    ? `+${digits}`
    : digits.startsWith('61')
      ? `+${digits}`
      : digits.startsWith('0')
        ? `+61${digits.slice(1)}`
        : undefined;
  return normalized && /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : undefined;
}

export function buildKlaviyoContactIdentity(input: KlaviyoContactIdentityInput): KlaviyoContactIdentity {
  if (!['retail_customer', 'b2b_customer', 'both'].includes(input.contactType)) {
    return { eligible: false, reason: 'unsupported_contact_type', profile: null };
  }
  if (!input.businessId.trim() || !Number.isInteger(input.contactId) || input.contactId <= 0) {
    return { eligible: false, reason: 'invalid_identity', profile: null };
  }

  const email = normalizeKlaviyoEmail(input.email);
  const phoneNumber = normalizeKlaviyoPhone(input.mobile) ?? normalizeKlaviyoPhone(input.phone);
  return {
    eligible: true,
    reason: 'eligible',
    profile: {
      externalId: `solvantis:${input.businessId}:contact:${input.contactId}`,
      ...(email ? { email } : {}),
      ...(phoneNumber ? { phoneNumber } : {}),
    },
  };
}

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a finite non-negative number.`);
  return value;
}

export function buildKlaviyoPlacedOrderEvents(input: KlaviyoPlacedOrderInput): KlaviyoEventInput[] {
  const currency = input.currency?.trim().toUpperCase() || 'AUD';
  const orderProperties = {
    OrderId: input.orderId,
    Source: input.source,
    ...(input.locationId == null ? {} : { LocationId: String(input.locationId) }),
    ItemCount: input.lines.reduce((total, line) => total + line.quantity, 0),
  };
  const common = {
    profile: input.profile,
    occurredAt: input.occurredAt,
    valueCurrency: currency,
    ...(input.backfill == null ? {} : { backfill: input.backfill }),
  };
  const version = KLAVIYO_COMMERCE_EVENT_VERSION;

  return [
    {
      ...common,
      metricName: 'Placed Order',
      uniqueId: `${input.source}:order:${input.orderId}:placed:v${version}`,
      value: finiteNonNegative(input.totalValue, 'totalValue'),
      properties: orderProperties,
    },
    ...input.lines.map((line) => ({
      ...common,
      metricName: 'Ordered Product',
      uniqueId: `${input.source}:order:${input.orderId}:line:${line.lineId}:v${version}`,
      value: finiteNonNegative(line.lineValue, 'lineValue'),
      properties: {
        ...orderProperties,
        LineId: line.lineId,
        ProductName: line.productName,
        Quantity: finiteNonNegative(line.quantity, 'quantity'),
        UnitPrice: finiteNonNegative(line.unitPrice, 'unitPrice'),
        ...(line.productId ? { ProductId: line.productId } : {}),
        ...(line.variantId ? { VariantId: line.variantId } : {}),
        ...(line.sku ? { SKU: line.sku } : {}),
      },
    })),
  ];
}