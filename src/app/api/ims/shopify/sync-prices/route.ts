import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { getShopifyForBusiness, shopifyVariantPricePayload } from '@/lib/ims/shopifyInventorySync';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const encoder = new TextEncoder();
  const send = (ctrl: ReadableStreamDefaultController, data: object) =>
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { product_ids }: { product_ids?: string[] } = await req.json().catch(() => ({}));

        const shopify = await getShopifyForBusiness(session.businessId);
        if (!shopify) {
          send(controller, { error: 'Shopify not connected.' });
          controller.close();
          return;
        }

        // Fetch all linked variants, including their Shopify product ID for bulk grouping
        let sql = `SELECT v.variant_id, v.shopify_variant_id, v.price_rrp, v.price_rrp_sale,
                          p.shopify_product_id
                   FROM ims_product_variants v
                   JOIN ims_products p ON p.product_id = v.product_id
                   WHERE v.shopify_variant_id IS NOT NULL AND v.is_active = 1
                     AND p.shopify_product_id IS NOT NULL`;
        const params: any[] = [];
        if (product_ids && product_ids.length > 0) {
          sql += ` AND p.product_id IN (${product_ids.map(() => '?').join(',')})`;
          params.push(...product_ids);
        }

        const variants = await imsQuery<{
          variant_id: string;
          shopify_variant_id: string;
          price_rrp: number | null;
          price_rrp_sale: number | null;
          shopify_product_id: string;
        }>(sql, params);

        // Group variants by Shopify product ID — one GraphQL call updates all
        // variants of a product at once instead of one REST call per variant.
        const byProduct = new Map<string, typeof variants>();
        for (const v of variants) {
          if (!byProduct.has(v.shopify_product_id)) byProduct.set(v.shopify_product_id, []);
          byProduct.get(v.shopify_product_id)!.push(v);
        }

        const productEntries = [...byProduct.entries()];
        const total = variants.length;
        let synced = 0;
        const errors: string[] = [];

        send(controller, { progress: { synced: 0, total, products: productEntries.length } });

        // Process 3 products concurrently — each call updates all variants of that
        // product in one round-trip, respecting Shopify's GraphQL rate limits.
        const BATCH = 3;
        for (let i = 0; i < productEntries.length; i += BATCH) {
          await Promise.all(
            productEntries.slice(i, i + BATCH).map(async ([shopifyProductId, pvariants]) => {
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
          send(controller, { progress: { synced, total, errors: errors.length } });
          if (i + BATCH < productEntries.length) await new Promise(r => setTimeout(r, 300));
        }

        const status = errors.length === 0 ? 'success' : synced > 0 ? 'partial' : 'error';
        const action = product_ids ? 'sync_prices' : 'resync';
        await ImsShopifyRepo.logAction(action, status,
          `Synced prices for ${synced}/${total} variants`, session.businessId,
          { errors: errors.slice(0, 20) }).catch(() => {});

        send(controller, { done: true, synced, total, errors: errors.slice(0, 20) });
      } catch (e: any) {
        send(controller, { error: e.message });
        await ImsShopifyRepo.logAction('sync_prices', 'error', e.message, session?.businessId ?? '').catch(() => {});
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',   // prevents nginx/Cloudflare from buffering
    },
  });
}


function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const { product_ids }: { product_ids?: string[] } = await req.json().catch(() => ({}));

    const shopify = await getShopifyForBusiness(session.businessId);
    if (!shopify) {
      return NextResponse.json({ success: false, error: 'Shopify not connected.' }, { status: 400 });
    }

    // Fetch linked variants
    let sql = `SELECT v.variant_id, v.shopify_variant_id, v.price_rrp, v.price_rrp_sale
               FROM ims_product_variants v
               JOIN ims_products p ON p.product_id = v.product_id
               WHERE v.shopify_variant_id IS NOT NULL AND v.is_active = 1`;
    const params: any[] = [];
    if (product_ids && product_ids.length > 0) {
      sql += ` AND p.product_id IN (${product_ids.map(() => '?').join(',')})`;
      params.push(...product_ids);
    }
    const variants = await imsQuery<{
      variant_id: string; shopify_variant_id: string; price_rrp: number | null; price_rrp_sale: number | null;
    }>(sql, params);

    let synced = 0;
    const errors: string[] = [];

    // Process in concurrent batches to avoid sequential slowness hitting the
    // Cloudflare 524 timeout. Batch size 5 respects Shopify's 2 req/s average
    // rate limit while the 40-request burst bucket absorbs the initial load.
    const BATCH = 5;
    for (let i = 0; i < variants.length; i += BATCH) {
      await Promise.all(
        variants.slice(i, i + BATCH).map(async (v) => {
          try {
            await shopify.updateVariant(v.shopify_variant_id, shopifyVariantPricePayload(v.price_rrp, v.price_rrp_sale));
            synced++;
          } catch (err: any) {
            errors.push(`variant ${v.variant_id}: ${err.message}`);
          }
        })
      );
      // Brief pause between batches to stay within Shopify's leaky-bucket rate limit
      if (i + BATCH < variants.length) await new Promise(r => setTimeout(r, 300));
    }

    const status = errors.length === 0 ? 'success' : synced > 0 ? 'partial' : 'error';
    const action = product_ids ? 'sync_prices' : 'resync';
    await ImsShopifyRepo.logAction(action, status,
      `Synced prices for ${synced}/${variants.length} variants`, session.businessId,
      { errors: errors.slice(0, 20) }).catch(() => {});

    return NextResponse.json({ success: true, synced, total: variants.length, errors });
  } catch (e: any) {
    await ImsShopifyRepo.logAction('sync_prices', 'error', e.message, session?.businessId ?? '').catch(() => {});
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

