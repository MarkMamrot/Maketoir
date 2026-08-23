export interface StorefrontMoney {
  amount: number;
  currency: 'AUD';
}

export interface StorefrontProductImage {
  id: string;
  url: string;
  altText: string;
  sortOrder: number;
}

export interface StorefrontProductVariant {
  variantId: string;
  sku: string | null;
  barcode: string | null;
  optionValues: string[];
  price: StorefrontMoney;
  compareAtPrice: StorefrontMoney | null;
  availableUnits: number;
}

export interface StorefrontProductProjection {
  productId: string;
  slug: string;
  name: string;
  descriptionHtml: string;
  brand: string | null;
  category: string | null;
  images: StorefrontProductImage[];
  variants: StorefrontProductVariant[];
}

export interface StorefrontCartLine {
  variantId: string;
  quantity: number;
}

export interface StorefrontCart {
  lines: StorefrontCartLine[];
}

export function normalizeStorefrontCart(input: unknown): StorefrontCart {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { lines?: unknown }).lines)) {
    return { lines: [] };
  }
  const quantities = new Map<string, number>();
  for (const item of (input as { lines: unknown[] }).lines.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const variantId = String((item as { variantId?: unknown }).variantId ?? '').trim().slice(0, 100);
    const quantity = Number((item as { quantity?: unknown }).quantity);
    if (!variantId || !Number.isSafeInteger(quantity) || quantity <= 0) continue;
    quantities.set(variantId, Math.min(999, (quantities.get(variantId) ?? 0) + quantity));
  }
  return { lines: Array.from(quantities, ([variantId, quantity]) => ({ variantId, quantity })) };
}