export interface OnlineGatewayMapping {
  gateway_name: string;
  clearing_account_code: string | null;
  fee_account_code?: string | null;
  fee_tax_type?: string | null;
  deduct_fee_enabled?: boolean | number | null;
  fixed_fee_amount?: number | string | null;
  percentage_fee_rate?: number | string | null;
}

export function normalizeOnlineGateway(value: string | null | undefined): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return normalized || '_unknown';
}

export function splitOnlineGateways(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(/[,;+]/)
    .map(normalizeOnlineGateway)
    .filter(gateway => gateway !== '_unknown');
}

export function isShopifyPaymentsGateway(value: string | null | undefined): boolean {
  return splitOnlineGateways(value).some(gateway =>
    gateway === 'shopify_payments' || gateway === 'shopify_payment',
  );
}

export function findOnlineGatewayClearingAccount(
  gateway: string,
  mappings: OnlineGatewayMapping[],
): string | null {
  const gatewayNames = splitOnlineGateways(gateway);
  for (const mapping of mappings) {
    if (!mapping.clearing_account_code) continue;
    const mappingName = normalizeOnlineGateway(mapping.gateway_name);
    if (mappingName === '_unknown') continue;
    if (gatewayNames.some(name => name.includes(mappingName) || mappingName.includes(name))) {
      return mapping.clearing_account_code;
    }
  }
  return null;
}

export function findOnlineGatewayMapping(
  gateway: string,
  mappings: OnlineGatewayMapping[],
): OnlineGatewayMapping | null {
  const gatewayNames = splitOnlineGateways(gateway);
  return mappings.find(mapping => {
    const mappingName = normalizeOnlineGateway(mapping.gateway_name);
    return mappingName !== '_unknown' && gatewayNames.some(name => name.includes(mappingName) || mappingName.includes(name));
  }) ?? null;
}