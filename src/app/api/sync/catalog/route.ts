// src/app/api/sync/catalog/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '../../../../services/ShopifyService';
import { getPool } from '@/services/MySQLService';

/**
 * GET /api/sync/catalog?shopId=...&accessToken=...
 * Quick connection test — fetches 1 product to verify credentials.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const shopId = searchParams.get('shopId') || '';
    const accessToken = searchParams.get('accessToken') || '';
    if (!shopId || !accessToken) {
      return NextResponse.json({ success: false, error: 'shopId and accessToken are required.' }, { status: 400 });
    }
    const shopify = new ShopifyService(shopId, accessToken);
    const catalog = await shopify.getCatalog();
    return NextResponse.json({ success: true, message: `Connected — ${catalog.length} products found.`, count: catalog.length });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/sync/catalog
 * Body: { shopId, accessToken, businessId }
 * Fetches Shopify catalog and upserts all variants into shopify_products.
 */
export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
    const { businessId: businessId } = JSON.parse(session.value);

    const { shopId, accessToken } = await req.json();
    if (!shopId || !accessToken) {
      return NextResponse.json({ success: false, error: 'shopId and accessToken are required.' }, { status: 400 });
    }

    const shopify = new ShopifyService(shopId, accessToken);
    const catalog = await shopify.getCatalog();

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const pool = getPool();

    // Delete existing rows for this business then batch-insert fresh ones
    await pool.query('DELETE FROM shopify_products WHERE business_id = ?', [businessId]);

    const chunkSize = 200;
    for (let i = 0; i < catalog.length; i += chunkSize) {
      const chunk = catalog.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const vals: any[] = [];
      for (const p of chunk) {
        const variants: any[] = (p as any).variants ?? [{}];
        for (const v of variants) {
          vals.push(
            businessId,
            p.id ?? 0,
            v.id ?? 0,
            (p as any).title ?? null,
            (p as any).vendor ?? null,
            (p as any).product_type ?? null,
            (p as any).handle ?? null,
            (p as any).status ?? null,
            ((p as any).tags ?? []).join(', '),
            (p as any).body_html ?? null,
            v.sku ?? null,
            v.price ?? null,
            v.compare_at_price ?? null,
            v.inventory_quantity ?? null,
            now,
          );
        }
      }
      if (vals.length > 0) {
        // Recalculate placeholders based on actual variant count
        const rowCount = vals.length / 15;
        const ph = Array.from({ length: rowCount }, () => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        await pool.query(
          `INSERT INTO shopify_products
             (business_id, shopify_id, variant_id, title, vendor, product_type, handle, status, tags, body_html,
              sku, price, compare_at_price, inventory_qty, last_synced_at)
           VALUES ${ph}
           ON DUPLICATE KEY UPDATE
             title=VALUES(title), vendor=VALUES(vendor), product_type=VALUES(product_type),
             status=VALUES(status), tags=VALUES(tags), sku=VALUES(sku),
             price=VALUES(price), compare_at_price=VALUES(compare_at_price),
             inventory_qty=VALUES(inventory_qty), last_synced_at=VALUES(last_synced_at)`,
          vals,
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${catalog.length} products to database.`,
      count: catalog.length,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
