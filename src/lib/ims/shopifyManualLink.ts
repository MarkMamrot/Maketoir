export type LocalShopifyLinkVariant = {
  variant_id: string;
  sku?: string | null;
  barcode?: string | null;
};

export type RemoteShopifyLinkVariant = {
  id: string | number;
  inventory_item_id?: string | number | null;
  sku?: string | null;
  barcode?: string | null;
};

export function parseShopifyProductId(value: unknown): string | null {
  const input = String(value ?? '').trim();
  const direct = input.match(/^\d{6,20}$/)?.[0];
  if (direct) return direct;
  const fromUrl = input.match(/\/products\/(\d{6,20})(?:[/?#]|$)/i)?.[1];
  return fromUrl ?? null;
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function matchShopifyVariants(
  localVariants: LocalShopifyLinkVariant[],
  remoteVariants: RemoteShopifyLinkVariant[],
): Array<{ variantId: string; shopifyVariantId: string; shopifyInventoryItemId: string }> {
  const uniqueRemote = (field: 'sku' | 'barcode', value: string) => {
    const matches = remoteVariants.filter(variant => normalized(variant[field]) === value);
    return matches.length === 1 ? matches[0] : null;
  };

  const usedRemoteIds = new Set<string>();
  const matches: Array<{ variantId: string; shopifyVariantId: string; shopifyInventoryItemId: string }> = [];
  for (const local of localVariants) {
    const sku = normalized(local.sku);
    const barcode = normalized(local.barcode);
    const skuMatch = sku ? uniqueRemote('sku', sku) : null;
    const barcodeMatch = barcode ? uniqueRemote('barcode', barcode) : null;
    if (skuMatch && barcodeMatch && String(skuMatch.id) !== String(barcodeMatch.id)) continue;
    const remote = skuMatch ?? barcodeMatch;
    if (!remote?.inventory_item_id) continue;
    const remoteId = String(remote.id);
    if (usedRemoteIds.has(remoteId)) continue;
    usedRemoteIds.add(remoteId);
    matches.push({
      variantId: local.variant_id,
      shopifyVariantId: remoteId,
      shopifyInventoryItemId: String(remote.inventory_item_id),
    });
  }
  return matches;
}