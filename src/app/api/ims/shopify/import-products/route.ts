import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import {
  ImsBrandsRepo,
  ImsContactsRepo,
  ImsImagesRepo,
  ImsProductsRepo,
  ImsShopifyRepo,
  ImsVariantsRepo,
  type ImsProduct,
  type ImsVariant,
} from '@/lib/ims/ImsRepository';
import {
  planShopifyProductImport,
  planShopifyVariantImport,
  uniqueShopifyVariantIdentifier,
} from '@/lib/ims/shopifyProductImport';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;

function text(value: unknown): string | null {
  const result = String(value ?? '').trim();
  return result || null;
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

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Math.floor(Number(body?.limit ?? DEFAULT_BATCH_SIZE)), MAX_BATCH_SIZE));
    const pageInfo = text(body?.page_info);
    const populateUnknownBrands = body?.populate_unknown_brands === true;
    const populateUnknownSuppliers = body?.populate_unknown_suppliers === true;
    const credentials = await getShopifyAdminCredentials(businessId);
    if (!credentials) {
      return NextResponse.json({ success: false, error: 'Shopify not connected.' }, { status: 400 });
    }

    const shopify = new ShopifyService(credentials.shopDomain, credentials.token);
    const page = await shopify.getProductsPage({ limit, pageInfo });
    const products = await imsQuery<ImsProduct>(
      `SELECT * FROM ims_products WHERE business_id = ?`,
      [businessId],
    );
    const variants = await imsQuery<ImsVariant>(
      `SELECT * FROM ims_product_variants WHERE business_id = ?`,
      [businessId],
    );
    const brandNames = new Set(
      populateUnknownBrands
        ? (await ImsBrandsRepo.list(businessId)).map(brand => brand.name.trim().toLowerCase())
        : [],
    );
    const suppliersByName = new Map<string, number>();
    if (populateUnknownSuppliers) {
      for (const supplier of await ImsContactsRepo.list('supplier', false, businessId)) {
        const supplierName = text(supplier.name)?.toLowerCase();
        const supplierCompany = text(supplier.company)?.toLowerCase();
        if (supplierName) suppliersByName.set(supplierName, supplier.id);
        if (supplierCompany) suppliersByName.set(supplierCompany, supplier.id);
      }
    }

    let createdProducts = 0;
    let updatedProducts = 0;
    let createdVariants = 0;
    let updatedVariants = 0;
    let imagesCollected = 0;
    let createdBrands = 0;
    let createdSuppliers = 0;
    const warnings: string[] = [];
    const identifierAdjustments: string[] = [];

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

      const vendor = text(shopifyProduct.vendor);
      const vendorKey = vendor?.toLowerCase() ?? null;
      if (populateUnknownBrands && vendor && vendorKey && !brandNames.has(vendorKey)) {
        await ImsBrandsRepo.create(vendor, businessId);
        brandNames.add(vendorKey);
        createdBrands++;
      }
      let supplierContactId = vendorKey ? suppliersByName.get(vendorKey) ?? null : null;
      if (populateUnknownSuppliers && vendor && vendorKey && supplierContactId === null) {
        supplierContactId = await ImsContactsRepo.create({
          business_id: businessId,
          type: 'supplier',
          name: vendor,
          company: vendor,
          is_active: 1,
        }, businessId);
        suppliersByName.set(vendorKey, supplierContactId);
        createdSuppliers++;
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
          supplier_contact_id: supplierContactId ?? undefined,
          shopify_product_id: String(shopifyProduct.id),
        }, businessId);
        products.push({ id: 0, product_id: productId, business_id: businessId, name: shopifyProduct.title, is_active: 1, shopify_product_id: String(shopifyProduct.id) } as ImsProduct);
        createdProducts++;
      } else {
        productId = plan.productId;
        await imsExecute(
          `UPDATE ims_products
              SET name = ?, description = ?, product_type = ?, brand = ?, tags = ?, website_title = ?,
                is_online = ?, shopify_product_id = ?, supplier_contact_id = COALESCE(?, supplier_contact_id)
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
            supplierContactId,
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
        const variantPlan = planShopifyVariantImport(
          shopifyVariant,
          productId,
          variants.map(variant => ({
            variantId: variant.variant_id,
            productId: variant.product_id,
            shopifyVariantId: variant.shopify_variant_id,
            sku: variant.sku,
            barcode: variant.barcode,
          })),
        );
        if (variantPlan.action === 'skip') {
          warnings.push(`${shopifyProduct.title ?? shopifyProduct.id} / ${shopifyVariant.title ?? shopifyVariant.id}: ${variantPlan.reason}`);
          continue;
        }

        const prices = variantPrices(shopifyVariant);
        const existingVariantId = variantPlan.action === 'use_existing' ? variantPlan.variantId : undefined;
        const sku = uniqueShopifyVariantIdentifier(shopifyVariant.sku, 'sku', variants.map(variant => ({
          variantId: variant.variant_id,
          productId: variant.product_id,
          sku: variant.sku,
        })), existingVariantId);
        const barcode = uniqueShopifyVariantIdentifier(shopifyVariant.barcode, 'barcode', variants.map(variant => ({
          variantId: variant.variant_id,
          productId: variant.product_id,
          barcode: variant.barcode,
        })), existingVariantId);
        if (sku !== text(shopifyVariant.sku)) {
          identifierAdjustments.push(`${shopifyProduct.title ?? shopifyProduct.id} / ${shopifyVariant.title ?? shopifyVariant.id}: SKU ${text(shopifyVariant.sku)} changed to ${sku}.`);
        }
        if (barcode !== text(shopifyVariant.barcode)) {
          identifierAdjustments.push(`${shopifyProduct.title ?? shopifyProduct.id} / ${shopifyVariant.title ?? shopifyVariant.id}: barcode ${text(shopifyVariant.barcode)} changed to ${barcode}.`);
        }
        const values = {
          sku,
          barcode,
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
        if (variantPlan.action === 'create') {
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
          variantId = variantPlan.variantId;
          await imsExecute(
            `UPDATE ims_product_variants
                SET sku = ?, barcode = ?, option1_name = ?, option1_value = ?, option2_name = ?, option2_value = ?,
                    option3_name = ?, option3_value = ?, price_rrp = ?, price_rrp_sale = ?, weight_kg = ?, is_active = 1
              WHERE variant_id = ? AND business_id = ?`,
            [values.sku, values.barcode, values.option1_name, values.option1_value, values.option2_name, values.option2_value,
             values.option3_name, values.option3_value, values.price_rrp, values.price_rrp_sale, values.weight_kg, variantId, businessId],
          );
          const localVariant = variants.find(variant => variant.variant_id === variantId);
          if (localVariant) Object.assign(localVariant, values);
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
        .slice(0, 10)
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
      { createdProducts, updatedProducts, createdVariants, updatedVariants, imagesCollected, createdBrands, createdSuppliers, warnings, identifierAdjustments },
    );

    return NextResponse.json({
      success: true,
      fetched: page.products.length,
      created_products: createdProducts,
      updated_products: updatedProducts,
      created_variants: createdVariants,
      updated_variants: updatedVariants,
      images_collected: imagesCollected,
      created_brands: createdBrands,
      created_suppliers: createdSuppliers,
      warnings,
      identifier_adjustments: identifierAdjustments,
      next_page_info: page.nextPageInfo,
      has_more: page.hasMore,
    });
  } catch (error: any) {
    await ImsShopifyRepo.logAction('reconcile', 'error', `Shopify product import failed: ${error.message}`, businessId).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}