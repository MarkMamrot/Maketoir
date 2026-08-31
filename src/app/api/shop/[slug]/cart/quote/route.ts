import { NextResponse } from 'next/server';
import { OnlineShopCatalogueRepository } from '@/lib/onlineShop/onlineShopCatalogue';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { normalizeStorefrontCart } from '@/lib/storefront/commerce';

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
  if (!profile) return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
  let cart;
  try { cart = normalizeStorefrontCart(await request.json()); } catch { return NextResponse.json({ error: 'A valid cart is required.' }, { status: 400 }); }
  try {
    const products = await OnlineShopCatalogueRepository.getPublishedByVariantIds(profile.businessId, cart.lines.map(line => line.variantId));
    const variants = new Map(products.flatMap(product => product.variants.map(variant => [variant.variantId, { product, variant }] as const)));
    const lines = cart.lines.flatMap(line => {
      const match = variants.get(line.variantId); if (!match) return [];
      const unitPriceCents = Math.round(match.variant.price.amount * 100);
      return [{ variantId: line.variantId, quantity: line.quantity, availableUnits: match.variant.availableUnits,
        tracksInventory: match.variant.tracksInventory, isAvailable: !match.variant.tracksInventory || line.quantity <= match.variant.availableUnits, productId: match.product.productId, productSlug: match.product.slug,
        name: match.product.name, optionLabel: match.variant.optionValues.join(' / '), image: match.product.images[0] ?? null,
        unitPriceCents, lineTotalCents: unitPriceCents * line.quantity }];
    });
    return NextResponse.json({ success: true, lines, subtotalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
      canCheckout: lines.length > 0 && lines.length === cart.lines.length && lines.every(line => line.isAvailable) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: profile.businessId, source: 'online_shop_cart', operation: 'quote', title: 'Online shop cart could not be quoted', error }).catch(() => {});
    return NextResponse.json({ error: 'The cart could not be refreshed.' }, { status: 500 });
  }
}