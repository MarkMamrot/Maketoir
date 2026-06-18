import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsProductsRepo, ImsVariantsRepo, ImsBrandsRepo, ImsContactsRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export interface BulkImportRow {
  action: 'new_product' | 'new_variant' | 'update' | 'error';
  // Product-level
  product_name: string;
  description?: string;
  product_type?: string;
  brand?: string;
  supplier_name?: string;
  tags?: string;
  style_code?: string;
  is_online?: number;
  // Variant-level
  sku?: string;
  barcode?: string;
  cost_aud?: number | null;
  price_rrp?: number | null;
  price_wholesale?: number | null;
  weight_kg?: number | null;
  pack_size?: number | null;
  bin?: string;
  zone?: string;
  option1_name?: string;
  option1_value?: string;
  option2_name?: string;
  option2_value?: string;
  option3_name?: string;
  option3_value?: string;
  cost_foreign?: string;
  // Resolved IDs (filled by classification step on the server)
  existing_variant_id?: string;
  existing_product_id?: string;
}

interface RequestBody {
  rows: BulkImportRow[];
  autoCreateBrands: string[];
  autoCreateSuppliers: string[];
}

export async function POST(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: RequestBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { rows, autoCreateBrands = [], autoCreateSuppliers = [] } = body;

  // 1. Create missing brands
  for (const brandName of autoCreateBrands) {
    if (brandName?.trim()) {
      try { await ImsBrandsRepo.create(brandName.trim()); } catch { /* ignore duplicate */ }
    }
  }

  // 2. Create missing suppliers (as contacts of type 'supplier')
  const supplierIdMap: Record<string, number> = {};
  for (const supplierName of autoCreateSuppliers) {
    if (supplierName?.trim()) {
      try {
        const id = await ImsContactsRepo.create({
          type: 'supplier', name: supplierName.trim(), is_active: 1,
        });
        supplierIdMap[supplierName.trim().toLowerCase()] = id;
      } catch { /* ignore */ }
    }
  }

  // 3. Re-load contacts to resolve supplier names → IDs
  const allContacts = await ImsContactsRepo.list('supplier');
  const contactByName = new Map<string, number>();
  for (const c of allContacts) {
    contactByName.set(c.name.trim().toLowerCase(), c.id);
    if (c.company) contactByName.set(c.company.trim().toLowerCase(), c.id);
  }

  let created = 0, updated = 0, skipped = 0;

  // 4. Process rows
  // Track newly created products within this batch so multi-variant imports work
  const createdProductIds = new Map<string, string>(); // lowercased name → product_id

  for (const row of rows) {
    try {
      if (row.action === 'error') { skipped++; continue; }

      // Resolve supplier contact id
      const supplierContactId = row.supplier_name
        ? contactByName.get(row.supplier_name.trim().toLowerCase()) ?? undefined
        : undefined;

      if (row.action === 'new_product') {
        // Create product
        const productId = await ImsProductsRepo.create({
          product_id: '',
          name: row.product_name,
          description: row.description,
          product_type: row.product_type,
          brand: row.brand,
          tags: row.tags,
          style_code: row.style_code,
          is_online: row.is_online ?? 1,
          supplier_contact_id: supplierContactId,
          is_active: 1,
        });
        createdProductIds.set(row.product_name.trim().toLowerCase(), productId);
        // Create variant
        await ImsVariantsRepo.create({
          variant_id: '',
          product_id: productId,
          sku: row.sku,
          barcode: row.barcode,
          cost_aud: row.cost_aud ?? undefined,
          price_rrp: row.price_rrp ?? undefined,
          price_wholesale: row.price_wholesale ?? undefined,
          weight_kg: row.weight_kg ?? undefined,
          pack_size: row.pack_size ?? undefined,
          bin: row.bin,
          zone: row.zone,
          option1_name: row.option1_name,
          option1_value: row.option1_value,
          option2_name: row.option2_name,
          option2_value: row.option2_value,
          option3_name: row.option3_name,
          option3_value: row.option3_value,
          cost_foreign: row.cost_foreign,
          is_active: 1,
        });
        created++;

      } else if (row.action === 'new_variant') {
        // Find existing product (from this batch or DB)
        let productId = createdProductIds.get(row.product_name.trim().toLowerCase());
        if (!productId) {
          const existing = await ImsProductsRepo.findByName(row.product_name);
          productId = existing?.product_id;
        }
        if (!productId) { skipped++; continue; }
        // Optionally update product-level fields if provided
        const productUpdates: Record<string, any> = {};
        if (row.description !== undefined && row.description !== '') productUpdates.description = row.description;
        if (row.product_type !== undefined && row.product_type !== '') productUpdates.product_type = row.product_type;
        if (row.brand !== undefined && row.brand !== '') productUpdates.brand = row.brand;
        if (row.tags !== undefined && row.tags !== '') productUpdates.tags = row.tags;
        if (supplierContactId) productUpdates.supplier_contact_id = supplierContactId;
        if (Object.keys(productUpdates).length) await ImsProductsRepo.update(productId, productUpdates);

        await ImsVariantsRepo.create({
          variant_id: '',
          product_id: productId,
          sku: row.sku,
          barcode: row.barcode,
          cost_aud: row.cost_aud ?? undefined,
          price_rrp: row.price_rrp ?? undefined,
          price_wholesale: row.price_wholesale ?? undefined,
          weight_kg: row.weight_kg ?? undefined,
          pack_size: row.pack_size ?? undefined,
          bin: row.bin,
          zone: row.zone,
          option1_name: row.option1_name,
          option1_value: row.option1_value,
          option2_name: row.option2_name,
          option2_value: row.option2_value,
          option3_name: row.option3_name,
          option3_value: row.option3_value,
          cost_foreign: row.cost_foreign,
          is_active: 1,
        });
        created++;

      } else if (row.action === 'update') {
        if (!row.existing_variant_id) { skipped++; continue; }
        // Update variant fields (only provided ones)
        const variantUpdates: Record<string, any> = {};
        if (row.sku !== undefined)              variantUpdates.sku = row.sku || null;
        if (row.barcode !== undefined)          variantUpdates.barcode = row.barcode || null;
        if (row.cost_aud !== undefined)             variantUpdates.cost_aud = row.cost_aud;
        if (row.price_rrp !== undefined)            variantUpdates.price_rrp = row.price_rrp;
        if (row.price_wholesale !== undefined)  variantUpdates.price_wholesale = row.price_wholesale;
        if (row.weight_kg !== undefined)        variantUpdates.weight_kg = row.weight_kg;
        if (row.pack_size !== undefined)        variantUpdates.pack_size = row.pack_size;
        if (row.bin !== undefined)              variantUpdates.bin = row.bin || null;
        if (row.zone !== undefined)             variantUpdates.zone = row.zone || null;
        if (row.option1_name !== undefined)     variantUpdates.option1_name = row.option1_name;
        if (row.option1_value !== undefined)    variantUpdates.option1_value = row.option1_value;
        if (row.option2_name !== undefined)     variantUpdates.option2_name = row.option2_name;
        if (row.option2_value !== undefined)    variantUpdates.option2_value = row.option2_value;
        if (row.option3_name !== undefined)     variantUpdates.option3_name = row.option3_name;
        if (row.option3_value !== undefined)    variantUpdates.option3_value = row.option3_value;
        if (row.cost_foreign !== undefined) variantUpdates.cost_foreign = row.cost_foreign;
        if (Object.keys(variantUpdates).length) {
          await ImsVariantsRepo.update(row.existing_variant_id, variantUpdates);
        }

        // Update product-level fields if provided
        if (row.existing_product_id) {
          const productUpdates: Record<string, any> = {};
          if (row.product_name !== undefined && row.product_name !== '') productUpdates.name = row.product_name;
          if (row.description !== undefined && row.description !== '') productUpdates.description = row.description;
          if (row.product_type !== undefined && row.product_type !== '') productUpdates.product_type = row.product_type;
          if (row.brand !== undefined && row.brand !== '') productUpdates.brand = row.brand;
          if (row.tags !== undefined && row.tags !== '') productUpdates.tags = row.tags;
          if (row.style_code !== undefined && row.style_code !== '') productUpdates.style_code = row.style_code;
          if (row.is_online !== undefined) productUpdates.is_online = row.is_online;
          if (supplierContactId) productUpdates.supplier_contact_id = supplierContactId;
          if (Object.keys(productUpdates).length) await ImsProductsRepo.update(row.existing_product_id, productUpdates);
        }
        updated++;
      }
    } catch (e: any) {
      skipped++;
    }
  }

  return NextResponse.json({ success: true, created, updated, skipped });
}


