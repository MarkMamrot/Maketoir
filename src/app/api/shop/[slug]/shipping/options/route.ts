import { NextResponse } from 'next/server';

import { OnlineShopCatalogueRepository } from '@/lib/onlineShop/onlineShopCatalogue';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { OnlineShopShippingRepository } from '@/lib/onlineShop/onlineShopShipping';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { normalizeStorefrontCart } from '@/lib/storefront/commerce';

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
  if (!profile) return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid shipping request is required.' }, { status: 400 }); }
  const cart = normalizeStorefrontCart(body?.cart);
  if (!cart.lines.length) return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 });
  try {
    const products = await OnlineShopCatalogueRepository.getPublishedByVariantIds(profile.businessId, cart.lines.map(line => line.variantId));
    const variants = new Map(products.flatMap(product => product.variants.map(variant => [variant.variantId, variant] as const)));
    if (variants.size !== cart.lines.length) return NextResponse.json({ error: 'One or more cart items are no longer available.' }, { status: 409 });
    const subtotalCents = cart.lines.reduce((sum, line) => sum + Math.round(variants.get(line.variantId)!.price.amount * 100) * line.quantity, 0);
    const [delivery, pickup] = await Promise.all([
      body?.address ? OnlineShopShippingRepository.quoteDelivery(profile.businessId, body.address, subtotalCents) : Promise.resolve(null),
      OnlineShopShippingRepository.listPickupOptions(profile.businessId),
    ]);
    return NextResponse.json({ success: true, subtotalCents, delivery, pickup });
  } catch (error) {
    if (error instanceof Error && /address|Australia|subtotal/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId: profile.businessId, source: 'online_shop_shipping', operation: 'quote',
      title: 'Online shop shipping could not be quoted', error }).catch(() => {});
    return NextResponse.json({ error: 'Shipping options could not be loaded.' }, { status: 500 });
  }
}