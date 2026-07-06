import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';
import { ImsImagesRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

async function getShopifyClient(businessId: string) {
  try {
    const conn = await ConnectionsRepository.get(businessId) as any;
    const encToken = conn?.shopify_access_token ?? '';
    const shopId   = conn?.shopify_shop_id ?? '';
    if (!encToken || !shopId) return null;
    return { token: decrypt(encToken), shop: shopId.replace(/\.myshopify\.com$/, '') };
  } catch { return null; }
}

async function getProductShopifyId(productId: string): Promise<string | null> {
  const rows = await imsQuery<{ shopify_product_id: string | null }>(
    'SELECT shopify_product_id FROM ims_products WHERE product_id = ?', [productId],
  );
  return rows[0]?.shopify_product_id ?? null;
}

/** GET /api/ims/products/[id]/images */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await ImsImagesRepo.list(params.id);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/ims/products/[id]/images
 * Body: { url: string, source?: 'shopify'|'google_drive'|'external', alt_text?: string, is_primary?: boolean }
 * Add an image by URL (no file upload — use /images/upload for that).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { url, source = 'external', alt_text, is_primary } = await req.json();
    if (!url) return NextResponse.json({ success: false, error: 'url required' }, { status: 400 });
    const id = await ImsImagesRepo.add(params.id, url, source, { altText: alt_text, isPrimary: !!is_primary });
    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * PATCH /api/ims/products/[id]/images
 * Body: { action: 'set_primary', image_id: number }
 *    or { action: 'reorder', ordered_ids: number[] }
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    if (body.action === 'set_primary') {
      await ImsImagesRepo.setPrimary(Number(body.image_id), params.id);

      // Sync featured image to Shopify
      try {
        const shopifyProductId = await getProductShopifyId(params.id);
        const shopify = await getShopifyClient(session.businessId);
        if (shopifyProductId && shopify) {
          const record = await ImsImagesRepo.get(Number(body.image_id));
          if (record) {
            // Find the Shopify image ID by looking up images list and matching URL
            const listRes = await fetch(
              `https://${shopify.shop}.myshopify.com/admin/api/2024-01/products/${shopifyProductId}/images.json`,
              { headers: { 'X-Shopify-Access-Token': shopify.token } },
            );
            if (listRes.ok) {
              const listData = await listRes.json();
              const shopifyImages: { id: number; src: string }[] = listData.images ?? [];
              const recordUrlBase = (record.url ?? '').split('?')[0];
              const matched = shopifyImages.find(si => si.src.split('?')[0] === recordUrlBase);
              if (matched) {
                // Set as the product's first (featured) image by reordering
                const orderedIds = [matched.id, ...shopifyImages.filter(si => si.id !== matched.id).map(si => si.id)];
                await fetch(
                  `https://${shopify.shop}.myshopify.com/admin/api/2024-01/products/${shopifyProductId}/images/reorder.json`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopify.token },
                    body: JSON.stringify({ image: orderedIds.map((id, pos) => ({ id, position: pos + 1 })) }),
                  },
                );
              }
            }
          }
        }
      } catch { /* Shopify sync failure is non-fatal */ }
    } else if (body.action === 'reorder') {
      await ImsImagesRepo.reorder(params.id, body.ordered_ids);
    } else {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/ims/products/[id]/images?imageId=123
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const imageId = Number(url.searchParams.get('imageId'));
    const deleteFromShopify = url.searchParams.get('deleteFromShopify') === 'true';
    if (!imageId) return NextResponse.json({ success: false, error: 'imageId required' }, { status: 400 });

    const record = await ImsImagesRepo.get(imageId);

    // Delete from Shopify if requested
    if (deleteFromShopify && record?.source === 'shopify') {
      try {
        const shopifyProductId = await getProductShopifyId(params.id);
        const shopify = await getShopifyClient(session.businessId);
        if (shopifyProductId && shopify) {
          // The Shopify image ID isn't stored locally — look it up by matching URL
          const listRes = await fetch(
            `https://${shopify.shop}.myshopify.com/admin/api/2024-01/products/${shopifyProductId}/images.json`,
            { headers: { 'X-Shopify-Access-Token': shopify.token } },
          );
          if (listRes.ok) {
            const listData = await listRes.json();
            const shopifyImages: { id: number; src: string }[] = listData.images ?? [];
            // Match by URL — compare without query string since CDN adds ?v= params
            const recordUrlBase = (record.url ?? '').split('?')[0];
            const matched = shopifyImages.find(si => si.src.split('?')[0] === recordUrlBase);
            if (matched) {
              await fetch(
                `https://${shopify.shop}.myshopify.com/admin/api/2024-01/products/${shopifyProductId}/images/${matched.id}.json`,
                { method: 'DELETE', headers: { 'X-Shopify-Access-Token': shopify.token } },
              );
            }
          }
        }
      } catch { /* Shopify delete failure is non-fatal — still remove from IMS */ }
    }

    // Delete from volume if stored locally
    if (record?.source === 'volume' && record.drive_file_id) {
      const filePath = path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', session.businessId ?? session.userSpreadsheetId, 'product-images', record.drive_file_id);
      try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    }

    await ImsImagesRepo.delete(imageId, params.id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
