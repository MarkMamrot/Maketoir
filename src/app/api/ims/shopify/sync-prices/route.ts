import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '@/services/ShopifyService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';

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

    const conn = await ConnectionsRepository.get(session.userSpreadsheetId);
    const rawShopId = conn?.shopify_shop_id ?? '';
    const encToken  = conn?.shopify_access_token ?? '';
    if (!rawShopId || !encToken) {
      return NextResponse.json({ success: false, error: 'Shopify not connected.' }, { status: 400 });
    }
    const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
    if (!/^[a-zA-Z0-9-]+$/.test(shopName)) {
      return NextResponse.json({ success: false, error: 'Invalid Shopify shop name.' }, { status: 400 });
    }
    const accessToken = decrypt(encToken);
    const shopify = new ShopifyService(shopName, accessToken);

    // Fetch linked variants
    let sql = `SELECT v.variant_id, v.shopify_variant_id, v.price, v.discounted_price
               FROM ims_product_variants v
               JOIN ims_products p ON p.product_id = v.product_id
               WHERE v.shopify_variant_id IS NOT NULL AND v.is_active = 1`;
    const params: any[] = [];
    if (product_ids && product_ids.length > 0) {
      sql += ` AND p.product_id IN (${product_ids.map(() => '?').join(',')})`;
      params.push(...product_ids);
    }
    const variants = await imsQuery<{
      variant_id: string; shopify_variant_id: string; price: number | null; discounted_price: number | null;
    }>(sql, params);

    let synced = 0;
    const errors: string[] = [];

    for (const v of variants) {
      try {
        await shopify.updateVariant(v.shopify_variant_id, {
          price: String(v.price ?? '0.00'),
          compare_at_price: v.discounted_price ? String(v.price ?? '0.00') : null,
        });
        synced++;
      } catch (err: any) {
        errors.push(`variant ${v.variant_id}: ${err.message}`);
      }
    }

    const status = errors.length === 0 ? 'success' : synced > 0 ? 'partial' : 'error';
    const action = product_ids ? 'sync_prices' : 'resync';
    await ImsShopifyRepo.logAction(action, status,
      `Synced prices for ${synced}/${variants.length} variants`, { errors: errors.slice(0, 20) });

    return NextResponse.json({ success: true, synced, total: variants.length, errors });
  } catch (e: any) {
    await ImsShopifyRepo.logAction('sync_prices', 'error', e.message).catch(() => {});
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
