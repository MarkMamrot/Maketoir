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

    for (const v of variants) {
      try {
        await shopify.updateVariant(v.shopify_variant_id, shopifyVariantPricePayload(v.price_rrp, v.price_rrp_sale));
        synced++;
      } catch (err: any) {
        errors.push(`variant ${v.variant_id}: ${err.message}`);
      }
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

