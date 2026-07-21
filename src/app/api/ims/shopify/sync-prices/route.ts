import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { getShopifyForBusiness, shopifyVariantPricePayload } from '@/lib/ims/shopifyInventorySync';


// ─── GET — return the full list of IMS product IDs that have Shopify links ────
// The frontend calls this once to discover what needs syncing, then drives the
// work itself by POSTing small batches — no long-lived connection needed.
export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const rows = await imsQuery<{ product_id: string; variant_count: number }>(
      `SELECT p.product_id,
              COUNT(v.variant_id) AS variant_count
       FROM ims_products p
       JOIN ims_product_variants v ON v.product_id = p.product_id
       WHERE p.shopify_product_id IS NOT NULL
         AND v.shopify_variant_id IS NOT NULL
         AND v.is_active = 1
       GROUP BY p.product_id`,
      [],
    );
    const productIds   = rows.map(r => r.product_id);
    const variantCount = rows.reduce((s, r) => s + Number(r.variant_count), 0);
    return NextResponse.json({ productIds, variantCount });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── POST — sync a batch of products (up to 30) ───────────────────────────────
// Accepts { product_ids: string[] } — the frontend splits its full list into
// chunks of ≤30 and calls this endpoint once per chunk. Each call completes
// well within Cloudflare's timeout. Uses GraphQL productVariantsBulkUpdate so
// each product is one round-trip regardless of how many variants it has.
const MAX_BATCH = 30;

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const { product_ids }: { product_ids?: string[] } = await req.json().catch(() => ({}));

    const shopify = await getShopifyForBusiness(session.businessId);
    if (!shopify) {
      return NextResponse.json({ success: false, error: 'Shopify not connected.' }, { status: 400 });
    }

    let sql = `SELECT v.variant_id, v.shopify_variant_id, v.price_rrp, v.price_rrp_sale,
                      p.shopify_product_id
               FROM ims_product_variants v
               JOIN ims_products p ON p.product_id = v.product_id
               WHERE v.shopify_variant_id IS NOT NULL AND v.is_active = 1
                 AND p.shopify_product_id IS NOT NULL`;
    const params: any[] = [];

    // Enforce batch size limit to keep each request well under the proxy timeout
    const batch = product_ids?.slice(0, MAX_BATCH);
    if (batch && batch.length > 0) {
      sql += ` AND p.product_id IN (${batch.map(() => '?').join(',')})`;
      params.push(...batch);
    }

    const variants = await imsQuery<{
      variant_id: string;
      shopify_variant_id: string;
      price_rrp: number | null;
      price_rrp_sale: number | null;
      shopify_product_id: string;
    }>(sql, params);

    // Group by Shopify product — one GraphQL call updates all variants of a
    // product at once, so a product with 10 variants costs 1 API call, not 10.
    const byProduct = new Map<string, typeof variants>();
    for (const v of variants) {
      if (!byProduct.has(v.shopify_product_id)) byProduct.set(v.shopify_product_id, []);
      byProduct.get(v.shopify_product_id)!.push(v);
    }

    let synced = 0;
    const errors: string[] = [];

    // 3 products concurrently — respects Shopify's GraphQL rate limit
    const entries = [...byProduct.entries()];
    const CONCURRENCY = 3;
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      await Promise.all(
        entries.slice(i, i + CONCURRENCY).map(async ([shopifyProductId, pvariants]) => {
          try {
            const payload = pvariants.map(v => ({
              ...shopifyVariantPricePayload(v.price_rrp, v.price_rrp_sale),
              shopify_variant_id: v.shopify_variant_id,
            }));
            const { userErrors } = await shopify.bulkUpdateVariantPrices(shopifyProductId, payload);
            if (userErrors.length > 0) {
              errors.push(...userErrors.map(e => `${shopifyProductId}: ${e.message}`));
            } else {
              synced += pvariants.length;
            }
          } catch (err: any) {
            errors.push(`product ${shopifyProductId}: ${err.message}`);
          }
        }),
      );
      if (i + CONCURRENCY < entries.length) await new Promise(r => setTimeout(r, 300));
    }

    return NextResponse.json({ success: true, synced, total: variants.length, errors });
  } catch (e: any) {
    await ImsShopifyRepo.logAction('sync_prices', 'error', e.message, session?.businessId ?? '').catch(() => {});
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

