import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { getInventorySource, getProductsWithSales } from '@/lib/dataProvider';

export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId required.' }, { status: 400 });

  try {
    const source = await getInventorySource(databaseId);

    type BrandAgg = { skus: Set<string>; totalQty: number; totalCost: number; sales90: number; sales180: number; sales365: number };
    const brandMap = new Map<string, BrandAgg>();

    if (source === 'solvantis') {
      const products = await getProductsWithSales(databaseId, 'solvantis');
      for (const p of products) {
        const brand = p.brand || '(No Brand)';
        const price = p.price ?? 0;
        if (!brandMap.has(brand)) brandMap.set(brand, { skus: new Set(), totalQty: 0, totalCost: 0, sales90: 0, sales180: 0, sales365: 0 });
        const a = brandMap.get(brand)!;
        if (p.sku) a.skus.add(p.sku);
        a.totalQty  += p.qty_on_hand;
        a.totalCost += (p.cost ?? 0) * p.qty_on_hand;
        a.sales90   += p.sales_qty_90d  * price;
        a.sales180  += p.sales_qty_180d * price;
        a.sales365  += p.sales_qty_12m  * price;
      }
    } else {
      const inventorySystemId = await resolveInventorySystemId(databaseId);
      const products = await ProductsRepository.list(inventorySystemId);
      for (const p of products) {
        const brand = p.brand || '(No Brand)';
        const soh  = Number(p.global_soh          ?? 0);
        const cost = Number(p.cost                ?? 0);
        const r90  = Number(p.sales_revenue_90d   ?? 0);
        const r180 = Number(p.sales_revenue_180d  ?? 0);
        const r12m = Number(p.sales_revenue_12m   ?? 0);
        if (!brandMap.has(brand)) brandMap.set(brand, { skus: new Set(), totalQty: 0, totalCost: 0, sales90: 0, sales180: 0, sales365: 0 });
        const a = brandMap.get(brand)!;
        if (p.code) a.skus.add(p.code);
        a.totalQty  += soh;
        a.totalCost += cost * soh;
        a.sales90   += r90;
        a.sales180  += r180;
        a.sales365  += r12m;
      }
    }

    const brands = Array.from(brandMap.entries())
      .map(([name, a]) => ({ name, skuCount: a.skus.size, totalQty: Math.round(a.totalQty), totalCost: a.totalCost, sales90: a.sales90, sales180: a.sales180, sales365: a.sales365 }))
      .sort((a, b) => b.sales365 - a.sales365);

    const totals = brands.reduce(
      (t, b) => ({ skuCount: t.skuCount + b.skuCount, totalQty: t.totalQty + b.totalQty, totalCost: t.totalCost + b.totalCost, sales90: t.sales90 + b.sales90, sales180: t.sales180 + b.sales180, sales365: t.sales365 + b.sales365 }),
      { skuCount: 0, totalQty: 0, totalCost: 0, sales90: 0, sales180: 0, sales365: 0 },
    );

    return NextResponse.json({ success: true, brands, totals });
  } catch (err: any) {
    console.error('[brand-summary GET]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
