import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import {
  ImsImagesRepo,
  ImsProductsRepo,
  ImsShopifyRepo,
  ImsVariantsRepo,
  type ImsProduct,
  type ImsVariant,
} from '@/lib/ims/ImsRepository';
import { planShopifyProductImport } from '@/lib/ims/shopifyProductImport';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;

function text(value: unknown): string | null {
  const result = String(value ?? '').trim();
  return result || null;
}

function normalized(value: unknown): string | null {
  return text(value)?.toLowerCase() ?? null;
}

function weightKg(variant: any): number | null {
  const weight = Number(variant.weight);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  if (variant.weight_unit === 'g') return weight / 1000;
  if (variant.weight_unit === 'lb') return weight * 0.45359237;
  if (variant.weight_unit === 'oz') return weight * 0.028349523125;
  return weight;
}

function variantPrices(variant: any): { priceRrp: number | null; salePrice: number | null } {
  const price = Number(variant.price);
  const compareAt = Number(variant.compare_at_price);
  const validPrice = Number.isFinite(price) ? price : null;
  if (validPrice !== null && Number.isFinite(compareAt) && compareAt > validPrice) {
    return { priceRrp: compareAt, salePrice: validPrice };
  }
  return { priceRrp: validPrice, salePrice: null };
}

function findVariantMatch(shopifyVariant: any, targetProductId: string, variants: ImsVariant[]): ImsVariant | null | 'ambiguous' {
  const directlyLinked = variants.filter(variant => String(variant.shopify_variant_id ?? '') === String(shopifyVariant.id));
  if (directlyLinked.length === 1) return directlyLinked[0].product_id === targetProductId ? directlyLinked[0] : 'ambiguous';
  if (directlyLinked.length > 1) return 'ambiguous';

  const sku = normalized(shopifyVariant.sku);
  const barcode = normalized(shopifyVariant.barcode);
  const identifierMatches = variants.filter(variant =>
    (sku !== null && normalized(variant.sku) === sku)
    || (barcode !== null && normalized(variant.barcode) === barcode),
  );
  if (identifierMatches.length === 1) {
    return identifierMatches[0].product_id === targetProductId ? identifierMatches[0] : 'ambiguous';
  }
  if (identifierMatches.length > 1) return 'ambiguous';
  return null;
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Math.floor(Number(body?.limit ?? DEFAULT_BATCH_SIZE)), MAX_BATCH_SIZE));
    const afterId = text(body?.after_id);
    const credentials = await getShopifyAdminCredentials(businessId);
    if (!credentials) {
      return NextResponse.json({ success: false, error: 'Shopify not connected.' }, { status: 400 });
    }

    const shopify = new ShopifyService(credentials.shopDomain, credentials.token);
    const page = await shopify.getProductsPage({ limit, afterId });
    const products = await imsQuery<ImsProduct>(
      `SELECT * FROM ims_products WHERE business_id = ?`,
      [businessId],
    );
    const variants = await imsQuery<ImsVariant>(
      `SELECT * FROM ims_product_variants WHERE business_id = ?`,
      [businessId],
    );

    let createdProducts = 0;
    let updatedProducts = 0;
    let createdVariants = 0;
    let updatedVariants = 0;
    let imagesCollected = 0;
    const warnings: string[] = [];

    for (const shopifyProduct of page.products) {
      const plan = planShopifyProductImport(
        shopifyProduct,
        products.map(product => ({ productId: product.product_id, shopifyProductId: product.shopify_product_id })),
        variants.map(variant => ({
          variantId: variant.variant_id,
          productId: variant.product_id,
          shopifyVariantId: variant.shopify_variant_id,
          sku: variant.sku,
          barcode: variant.barcode,
        })),
      );
      if (plan.action === 'skip') {
        warnings.push(`${shopifyProduct.title ?? shopifyProduct.id}: ${plan.reason}`);
        continue;
      }

      let productId: string;
      if (plan.action === 'create') {
        productId = await ImsProductsRepo.create({
          product_id: '',
          name: text(shopifyProduct.title) ?? `Shopify product ${shopifyProduct.id}`,
          description: text(shopifyProduct.body_html) ?? undefined,
          product_type: text(shopifyProduct.product_type) ?? undefined,
          brand: text(shopifyProduct.vendor) ?? undefined,
          tags: Array.isArray(shopifyProduct.tags) ? shopifyProduct.tags.join(', ') : text(shopifyProduct.tags) ?? undefined,
          website_title: text(shopifyProduct.title) ?? undefined,
          is_online: shopifyProduct.status === 'active' ? 1 : 0,
          is_stock_item: 1,
          is_active: 1,
          shopify_product_id: String(shopifyProduct.id),
        }, businessId);
        products.push({ id: 0, product_id: productId, business_id: businessId, name: shopifyProduct.title, is_active: 1, shopify_product_id: String(shopifyProduct.id) } as ImsProduct);
        createdProducts++;
      } else {
        productId = plan.productId;
        await imsExecute(
          `UPDATE ims_products
              SET name = ?, description = ?, product_type = ?, brand = ?, tags = ?, website_title = ?,
                  is_online = ?, shopify_product_id = ?
            WHERE product_id = ? AND business_id = ?`,
          [
            text(shopifyProduct.title) ?? `Shopify product ${shopifyProduct.id}`,
            text(shopifyProduct.body_html),
            text(shopifyProduct.product_type),
            text(shopifyProduct.vendor),
            Array.isArray(shopifyProduct.tags) ? shopifyProduct.tags.join(', ') : text(shopifyProduct.tags),
            text(shopifyProduct.title),
            shopifyProduct.status === 'active' ? 1 : 0,
            String(shopifyProduct.id),
            productId,
            businessId,
          ],
        );
        const localProduct = products.find(product => product.product_id === productId);
        if (localProduct) localProduct.shopify_product_id = String(shopifyProduct.id);
        updatedProducts++;
      }

      const optionNames = new Map<number, string>(
        (shopifyProduct.options ?? []).map((option: any) => [Number(option.position), text(option.name) ?? `Option ${option.position}`]),
      );
      for (const shopifyVariant of shopifyProduct.variants ?? []) {
        const match = findVariantMatch(shopifyVariant, productId, variants);
        if (match === 'ambiguous') {
          warnings.push(`${shopifyProduct.title ?? shopifyProduct.id} / ${shopifyVariant.title ?? shopifyVariant.id}: identifier matches are ambiguous.`);
          continue;
        }

        const prices = variantPrices(shopifyVariant);
        const values = {
          sku: text(shopifyVariant.sku),
          barcode: text(shopifyVariant.barcode),
          option1_name: text(shopifyVariant.option1) ? optionNames.get(1) : null,
          option1_value: text(shopifyVariant.option1),
          option2_name: text(shopifyVariant.option2) ? optionNames.get(2) : null,
          option2_value: text(shopifyVariant.option2),
          option3_name: text(shopifyVariant.option3) ? optionNames.get(3) : null,
          option3_value: text(shopifyVariant.option3),
          price_rrp: prices.priceRrp,
          price_rrp_sale: prices.salePrice,
          weight_kg: weightKg(shopifyVariant),
        };

        let variantId: string;
        if (!match) {
          variantId = await ImsVariantsRepo.create({
            variant_id: '',
            product_id: productId,
            ...values,
            shopify_variant_id: String(shopifyVariant.id),
            shopify_inventory_item_id: text(shopifyVariant.inventory_item_id) ?? undefined,
            is_active: 1,
          }, businessId);
          variants.push({ id: 0, variant_id: variantId, product_id: productId, ...values, shopify_variant_id: String(shopifyVariant.id), is_active: 1 } as ImsVariant);
          createdVariants++;
        } else {
          variantId = match.variant_id;
          await imsExecute(
            `UPDATE ims_product_variants
                SET sku = ?, barcode = ?, option1_name = ?, option1_value = ?, option2_name = ?, option2_value = ?,
                    option3_name = ?, option3_value = ?, price_rrp = ?, price_rrp_sale = ?, weight_kg = ?, is_active = 1
              WHERE variant_id = ? AND business_id = ?`,
            [values.sku, values.barcode, values.option1_name, values.option1_value, values.option2_name, values.option2_value,
             values.option3_name, values.option3_value, values.price_rrp, values.price_rrp_sale, values.weight_kg, variantId, businessId],
          );
          updatedVariants++;
        }
        await ImsShopifyRepo.linkVariant(
          variantId,
          String(shopifyVariant.id),
          text(shopifyVariant.inventory_item_id) ?? '',
          businessId,
        );
      }

      const images = (shopifyProduct.images ?? [])
        .filter((image: any) => text(image.src))
        .slice(0, 5)
        .map((image: any) => ({ src: String(image.src), alt: text(image.alt) ?? undefined }));
      await ImsImagesRepo.upsertFromShopify(productId, images);
      imagesCollected += images.length;
    }

    const summary = `Imported Shopify catalogue batch: ${createdProducts} new and ${updatedProducts} updated products`;
    await ImsShopifyRepo.logAction(
      'reconcile',
      warnings.length ? 'partial' : 'success',
      summary,
      businessId,
      { createdProducts, updatedProducts, createdVariants, updatedVariants, imagesCollected, warnings },
    );

    return NextResponse.json({
      success: true,
      fetched: page.products.length,
      created_products: createdProducts,
      updated_products: updatedProducts,
      created_variants: createdVariants,
      updated_variants: updatedVariants,
      images_collected: imagesCollected,
      warnings,
      next_after_id: page.nextAfterId,
      has_more: page.hasMore,
    });
  } catch (error: any) {
    await ImsShopifyRepo.logAction('reconcile', 'error', `Shopify product import failed: ${error.message}`, businessId).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}