import { NextResponse } from 'next/server';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { getInventorySource, getProductsWithSales } from '@/lib/dataProvider';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';

function parseNum(v: unknown): number {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 200);
  const period = searchParams.get('period') ?? '90d';

  try {
    const source = await getInventorySource(databaseId);

    type Row = { name: string; code: string; brand: string; soh: number; revenue: number };
    let rows: Row[];

    if (source === 'solvantis') {
      const products = await getProductsWithSales(databaseId, 'solvantis');
      rows = products
        .filter(p => p.qty_on_hand > 0)
        .map(p => {
          const price = p.price ?? 0;
          const revenue =
            period === '180d' ? p.sales_qty_180d * price :
            period === '12m'  ? p.sales_qty_12m  * price :
                                p.sales_qty_90d  * price;
          return { name: p.name, code: p.sku ?? '', brand: p.brand ?? '', soh: p.qty_on_hand, revenue };
        });
    } else {
      const inventorySystemId = await resolveInventorySystemId(databaseId);
      const products = await ProductsRepository.list(inventorySystemId);
      rows = products
        .filter(p => Number(p.global_soh ?? 0) > 0)
        .map(p => {
          const revenue =
            period === '180d' ? Number(p.sales_revenue_180d ?? 0) :
            period === '12m'  ? Number(p.sales_revenue_12m  ?? 0) :
                                Number(p.sales_revenue_90d  ?? 0);
          return { name: p.name ?? '', code: p.code ?? '', brand: p.brand ?? '', soh: Number(p.global_soh ?? 0), revenue };
        });
    }

    rows.sort((a, b) => b.revenue - a.revenue);
    return NextResponse.json({ success: true, sellers: rows.slice(0, limit) });
  } catch (err: any) {
    console.error('[top-sellers GET]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
