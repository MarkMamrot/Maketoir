export type ShopifyOrderDeliveryAddress = {
  delivery_address: string | null;
  delivery_address2: string | null;
  delivery_suburb: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_postcode: string | null;
  delivery_country: string | null;
};

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function parseShopifyOrderDeliveryAddress(order: unknown): ShopifyOrderDeliveryAddress {
  const source = order && typeof order === 'object'
    ? (order as { shipping_address?: unknown }).shipping_address
    : null;
  const address = source && typeof source === 'object' ? source as Record<string, unknown> : {};
  const city = text(address.city);

  return {
    delivery_address: text(address.address1),
    delivery_address2: text(address.address2),
    delivery_suburb: city,
    delivery_city: city,
    delivery_state: text(address.province_code) ?? text(address.province),
    delivery_postcode: text(address.zip),
    delivery_country: text(address.country_code) ?? text(address.country),
  };
}