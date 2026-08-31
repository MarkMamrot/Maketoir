/**
 * /api/ims/products/[id]/shopify-sync
 *
 * GET  — Online store status for a product: whether it's linked to Shopify,
 *        the storefront + admin URLs, and the current publish status.
 * POST — Push IMS product data (title, description, tags, price, images) to the
 *        linked Shopify product. Creates the product on Shopify if not yet linked.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { getIMSPool } from '@/services/IMSMySQLService';
import fs from 'fs';
import path from 'path';
import { ShopifyService } from '@/services/ShopifyService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { ImsProductsRepo, ImsImagesRepo, ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { shopifyInventoryPolicyPayload, shopifyVariantPricePayload, pushInventoryForBusiness } from '@/lib/ims/shopifyInventorySync';
import { matchShopifyVariants, parseShopifyProductId } from '@/lib/ims/shopifyManualLink';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';


async function getShopify(businessId: string) {
  const credentials = await getShopifyAdminCredentials(businessId);
  if (!credentials) return null;
  return { service: new ShopifyService(credentials.shopDomain, credentials.token), shopName: credentials.shopName, shopDomain: credentials.shopDomain, accessToken: credentials.token };
}

/**
 * Resolve a product image to a Shopify-compatible payload.
 * Accepts the full ImsProductImage record so no secondary DB lookup is needed.
 * - External/CDN URLs (https://...) → passed as src.
 * - Volume images (source='volume') → read from disk using businessId as directory.
 */
function resolveImagePayload(
  img: { url: string; source: string; drive_file_id?: string; alt_text?: string },
  businessId: string,
): { src?: string; attachment?: string; alt: string } | null {
  const alt = img.alt_text ?? '';
  if (/^https?:\/\//i.test(img.url)) {
    return { src: img.url, alt };
  }
  if (img.source === 'volume' && img.drive_file_id) {
    try {
      const filePath = path.join(
        process.env.UPLOAD_BASE_PATH ?? './uploads',
        businessId,
        'product-images',
        img.drive_file_id,
      );
      if (!fs.existsSync(filePath)) return null;
      const attachment = fs.readFileSync(filePath).toString('base64');
      return { attachment, alt };
    } catch {
      return null;
    }
  }
  return null;
}

function isShopifyImageMedia(img: { url: string; drive_file_id?: string | null }): boolean {
  const candidate = `${img.url ?? ''} ${img.drive_file_id ?? ''}`;
  if (/\.(mp4|mov|webm)(\?|$|\s)/i.test(candidate)) return false;
  return true;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const product = await ImsProductsRepo.get(params.id, session.businessId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const shopifyProductId = product.shopify_product_id ?? null;
    const shop = await getShopify(session.businessId);

    if (!shop) {
      return NextResponse.json({ success: true, connected: false, linked: !!shopifyProductId, shopifyProductId });
    }
    if (!shopifyProductId) {
      return NextResponse.json({ success: true, connected: true, linked: false, shopDomain: shop.shopDomain });
    }

    let handle = '';
    let published = false;
    let status = 'unknown';
    try {
      const sp = await shop.service.getProduct(shopifyProductId);
      handle = sp?.handle ?? '';
      published = !!sp?.published_at;
      status = sp?.status ?? 'unknown';
    } catch {}

    return NextResponse.json({
      success: true,
      connected: true,
      linked: true,
      shopifyProductId,
      shopDomain: shop.shopDomain,
      storefrontUrl: handle ? `https://${shop.shopDomain}/products/${handle}` : '',
      adminUrl: `https://admin.shopify.com/store/${shop.shopName}/products/${shopifyProductId}`,
      published,
      status,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load status' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== 'link' && action !== 'unlink') {
    return NextResponse.json({ error: 'Action must be link or unlink.' }, { status: 400 });
  }

  const product = await ImsProductsRepo.get(params.id, businessId);
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  const shop = await getShopify(businessId);
  if (!shop) return NextResponse.json({ error: 'Shopify is not connected.' }, { status: 400 });

  let shopifyProductId: string | null = null;
  let remoteProduct: any = null;
  let variantMatches: ReturnType<typeof matchShopifyVariants> = [];
  if (action === 'link') {
    shopifyProductId = parseShopifyProductId(body?.shopifyProductId);
    if (!shopifyProductId) {
      return NextResponse.json({ error: 'Enter the numeric Shopify product ID from its Admin URL.' }, { status: 400 });
    }
    if (product.shopify_product_id && String(product.shopify_product_id) !== shopifyProductId) {
      return NextResponse.json({ error: 'Delink the current Shopify product before linking a different one.' }, { status: 409 });
    }
    try {
      remoteProduct = await shop.service.getProduct(shopifyProductId);
    } catch {
      return NextResponse.json({ error: 'That Shopify product could not be found or accessed.' }, { status: 400 });
    }
    variantMatches = matchShopifyVariants(product.variants ?? [], remoteProduct?.variants ?? []);
  }

  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const [[lockedProduct]] = await connection.execute<any[]>(
      `SELECT shopify_product_id
         FROM ims_products
        WHERE product_id = ? AND business_id = ?
        FOR UPDATE`,
      [params.id, businessId],
    );
    if (!lockedProduct) {
      await connection.rollback();
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (action === 'unlink') {
      const [variants] = await connection.execute<any[]>(
        `SELECT variant_id FROM ims_product_variants WHERE product_id = ? AND business_id = ?`,
        [params.id, businessId],
      );
      const variantIds = variants.map(variant => String(variant.variant_id));
      if (variantIds.length) {
        await connection.execute(
          `DELETE FROM ims_shopify_inventory_queue WHERE variant_id IN (${variantIds.map(() => '?').join(',')})`,
          variantIds,
        );
      }
      await connection.execute(
        `UPDATE ims_product_variants
            SET shopify_variant_id = NULL, shopify_inventory_item_id = NULL
          WHERE product_id = ? AND business_id = ?`,
        [params.id, businessId],
      );
      await connection.execute(
        `UPDATE ims_products SET shopify_product_id = NULL WHERE product_id = ? AND business_id = ?`,
        [params.id, businessId],
      );
      await connection.commit();
      return NextResponse.json({ success: true, action, variantsDelinked: variantIds.length });
    }

    const [[duplicate]] = await connection.execute<any[]>(
      `SELECT product_id, name
         FROM ims_products
        WHERE business_id = ? AND shopify_product_id = ? AND product_id <> ?
        LIMIT 1`,
      [businessId, shopifyProductId, params.id],
    );
    if (duplicate) {
      await connection.rollback();
      return NextResponse.json({ error: `That Shopify product is already linked to ${duplicate.name}.` }, { status: 409 });
    }
    await connection.execute(
      `UPDATE ims_products SET shopify_product_id = ? WHERE product_id = ? AND business_id = ?`,
      [shopifyProductId, params.id, businessId],
    );
    await connection.execute(
      `UPDATE ims_product_variants
          SET shopify_variant_id = NULL, shopify_inventory_item_id = NULL
        WHERE product_id = ? AND business_id = ?`,
      [params.id, businessId],
    );
    for (const match of variantMatches) {
      await connection.execute(
        `UPDATE ims_product_variants
            SET shopify_variant_id = ?, shopify_inventory_item_id = ?
          WHERE variant_id = ? AND product_id = ? AND business_id = ?`,
        [match.shopifyVariantId, match.shopifyInventoryItemId, match.variantId, params.id, businessId],
      );
    }
    await connection.commit();
    return NextResponse.json({
      success: true,
      action,
      shopifyProductId,
      shopifyTitle: String(remoteProduct?.title ?? ''),
      variantsLinked: variantMatches.length,
      variantsTotal: product.variants?.length ?? 0,
    });
  } catch (error: any) {
    await connection.rollback().catch(() => {});
    await reportRuntimeIssue({
      businessId,
      source: 'shopify',
      operation: 'manage_product_link',
      title: 'Shopify product link update failed',
      error,
      context: { action, product_id: params.id, shopify_product_id: shopifyProductId },
      reference: { type: 'product', id: params.id },
    });
    return NextResponse.json({ error: error?.message ?? 'Shopify link update failed.' }, { status: 500 });
  } finally {
    connection.release();
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const product = await ImsProductsRepo.get(params.id, session.businessId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const shop = await getShopify(session.businessId);
    if (!shop) return NextResponse.json({ error: 'Shopify is not connected.' }, { status: 400 });

    const images = await ImsImagesRepo.list(params.id);
    const variants = product.variants ?? [];
    const firstPriced = variants.find(v => v.price_rrp != null);

    // ── If not yet linked → create the product on Shopify ────────────────────
    if (!product.shopify_product_id) {
      // Build options: only include an option axis when at least one variant has
      // a real non-empty value for it. This prevents single-variant products from
      // getting spurious "Size: Default" / "Colour: Default" options in Shopify.
      const hasOpt1 = variants.some(v => v.option1_name?.trim() && v.option1_value?.trim());
      const hasOpt2 = variants.some(v => v.option2_name?.trim() && v.option2_value?.trim());
      const hasOpt3 = variants.some(v => v.option3_name?.trim() && v.option3_value?.trim());
      const options: any[] = [];
      if (hasOpt1) options.push({ name: variants.find(v => v.option1_name?.trim())?.option1_name });
      if (hasOpt2) options.push({ name: variants.find(v => v.option2_name?.trim())?.option2_name });
      if (hasOpt3) options.push({ name: variants.find(v => v.option3_name?.trim())?.option3_name });

      const shopifyVariants = variants.map(v => {
        const { price, compare_at_price } = shopifyVariantPricePayload(v.price_rrp, v.price_rrp_sale);
        const vp: Record<string, any> = {
          sku: v.sku ?? '',
          barcode: v.barcode ?? undefined,
          price,
          compare_at_price: compare_at_price ?? undefined,
          weight: v.weight_kg ? v.weight_kg * 1000 : undefined,
          weight_unit: 'g',
          option1: hasOpt1 ? (v.option1_value?.trim() || 'Default') : 'Default Title',
          ...shopifyInventoryPolicyPayload(product.is_stock_item),
        };
        if (hasOpt2) vp.option2 = v.option2_value?.trim() || 'Default';
        if (hasOpt3) vp.option3 = v.option3_value?.trim() || 'Default';
        return vp;
      });

      const payload: any = {
        title: product.website_title?.trim() || product.name,
        body_html: product.description ?? '',
        vendor: product.brand ?? '',
        product_type: product.product_type ?? '',
        tags: product.tags ?? '',
        status: 'active',
        variants: shopifyVariants.length > 0 ? shopifyVariants : [{ price: String(firstPriced?.price_rrp ?? '0.00') }],
        options: options.length > 0 ? options : undefined,
      };
      const created = await shop.service.createProduct(payload);
      await ImsShopifyRepo.linkProduct(params.id, String(created.id), session.businessId);
      for (let i = 0; i < variants.length; i++) {
        const sv = created.variants?.[i];
        if (sv) await ImsShopifyRepo.linkVariant(variants[i].variant_id, String(sv.id), String(sv.inventory_item_id ?? ''), session.businessId);
      }
      // Push images one-by-one so we can update IMS URLs to Shopify CDN URLs (prevents re-upload on future syncs)
      let imagesAdded = 0;
      const imageErrors: string[] = [];
      for (const img of images) {
        if (!isShopifyImageMedia(img)) continue;
        const imgPayload = resolveImagePayload(img, session.businessId);
        if (!imgPayload) { imageErrors.push(`Image ${img.id}: could not resolve URL`); continue; }
        try {
          const createdImg = await shop.service.createProductImage(String(created.id), imgPayload);
          imagesAdded++;
          // Replace IMS URL with Shopify CDN URL — prevents duplicate on next push
          if (createdImg?.src) await ImsImagesRepo.updateUrl(img.id, createdImg.src).catch(() => {});
        } catch (imgErr: any) {
          const detail = imgErr.response?.body?.errors ?? imgErr.message ?? 'unknown';
          imageErrors.push(`Image ${img.id}: ${JSON.stringify(detail).slice(0, 100)}`);
        }
      }
      // Push inventory quantities using the same pick-location + buffer logic as the live sync
      const variantIds = variants.map(v => v.variant_id);
      const invResult = await pushInventoryForBusiness(session.businessId, { variantIds, force: true }).catch(() => ({ pushed: 0, skipped: 0, errors: ['Inventory push failed'], locationId: null }));
      await ImsShopifyRepo.logAction('upload', 'success', `Created "${product.name}" on Shopify (inventory pushed: ${invResult.pushed}, images: ${imagesAdded}${imageErrors.length ? `, ${imageErrors.length} image error(s)` : ''})`, session.businessId, { product_id: params.id }).catch(() => {});
      return NextResponse.json({ success: true, created: true, shopifyProductId: String(created.id), inventoryPushed: invResult.pushed, inventoryErrors: invResult.errors, imagesAdded, imageErrors });
    }

    // ── Already linked → update title / description / tags / price / images ──
    const shopifyProductId = product.shopify_product_id;
    await shop.service.updateProduct(shopifyProductId, {
      title: product.website_title?.trim() || product.name,
      body_html: product.description ?? '',
      vendor: product.brand ?? '',
      product_type: product.product_type ?? '',
      tags: product.tags ?? '',
    });

    // Prices, SKU and barcode per linked variant.
    // Use direct fetch (not the shopify-api-node wrapper) so sku + barcode fields are
    // not silently dropped by the library's type mapping.
    let pricesUpdated = 0;
    const variantErrors: string[] = [];
    for (const v of variants) {
      if (!v.shopify_variant_id) continue;
      const variantPayload: Record<string, any> = {
        ...shopifyVariantPricePayload(v.price_rrp, v.price_rrp_sale),
        ...shopifyInventoryPolicyPayload(product.is_stock_item),
      };
      if (v.sku)     variantPayload.sku     = v.sku;
      if (v.barcode) variantPayload.barcode = v.barcode;
      try {
        const vRes = await fetch(
          `https://${shop.shopName}.myshopify.com/admin/api/2024-01/variants/${v.shopify_variant_id}.json`,
          {
            method: 'PUT',
            headers: { 'X-Shopify-Access-Token': shop.accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ variant: { id: Number(v.shopify_variant_id), ...variantPayload } }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!vRes.ok) {
          const errText = await vRes.text();
          variantErrors.push(`Variant ${v.shopify_variant_id}: HTTP ${vRes.status} — ${errText.slice(0, 120)}`);
        } else {
          pricesUpdated++;
        }
      } catch (vErr: any) {
        variantErrors.push(`Variant ${v.shopify_variant_id}: ${vErr.message}`);
      }
    }

    // Append IMS images not already on the Shopify product (compare by URL, ignoring ?v= params)
    let imagesAdded = 0;
    const imageErrors: string[] = [];
    try {
      const sp = await shop.service.getProduct(shopifyProductId);
      const existing = new Set<string>((sp?.images ?? []).map((im: any) => String(im.src).split('?')[0]));
      for (const img of images) {
        if (!isShopifyImageMedia(img)) continue;
        const base = String(img.url).split('?')[0];
        if (existing.has(base)) continue;
        const imgPayload = resolveImagePayload(img, session.businessId);
        if (!imgPayload) { imageErrors.push(`Image ${img.id}: could not resolve URL`); continue; }
        try {
          const createdImg = await shop.service.createProductImage(shopifyProductId, imgPayload);
          imagesAdded++;
          // Replace IMS URL with Shopify CDN URL — prevents duplicate upload on next push
          if (createdImg?.src) await ImsImagesRepo.updateUrl(img.id, createdImg.src).catch(() => {});
        } catch (imgErr: any) {
          const detail = imgErr.response?.body?.errors ?? imgErr.message ?? 'unknown';
          imageErrors.push(`Image ${img.id}: ${JSON.stringify(detail).slice(0, 100)}`);
        }
      }
    } catch {}

    await ImsShopifyRepo.logAction('resync', 'success', `Pushed "${product.name}" to Shopify (prices/sku/barcode: ${pricesUpdated}${variantErrors.length ? `, ${variantErrors.length} variant error(s)` : ''}, images: +${imagesAdded}${imageErrors.length ? `, ${imageErrors.length} image error(s)` : ''})`, session.businessId, { product_id: params.id }).catch(() => {});

    // Push inventory quantities using the same pick-location + buffer logic as the live sync
    const linkedVariantIds = variants.filter(v => v.shopify_variant_id).map(v => v.variant_id);
    const invResult = await pushInventoryForBusiness(session.businessId, { variantIds: linkedVariantIds, force: true }).catch(() => ({ pushed: 0, skipped: 0, errors: ['Inventory push failed'], locationId: null }));

    return NextResponse.json({ success: true, updated: true, pricesUpdated, variantErrors, imagesAdded, imageErrors, inventoryPushed: invResult.pushed, inventoryErrors: invResult.errors });
  } catch (e: any) {
    // Surface the actual Shopify validation errors when available (e.g. 422 details)
    const shopifyErrors = e.response?.body?.errors ?? e.response?.body ?? null;
    const detail = shopifyErrors
      ? `${e.message}: ${JSON.stringify(shopifyErrors).slice(0, 400)}`
      : (e.message ?? 'Shopify push failed');
    await ImsShopifyRepo.logAction('resync', 'error', detail, session.businessId, { product_id: params.id }).catch(() => {});
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
