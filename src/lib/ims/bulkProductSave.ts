import { randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getIMSPool } from '@/services/IMSMySQLService';
import { isReservedShopifyFallbackSku } from '@/lib/shopifyFallbackVariant';
import { hashInventoryDocumentRequest } from '@/lib/ims/inventoryDocumentLifecycle';
import { applyStocktakeInTransaction } from '@/lib/ims/stocktakes/stocktakeOperations';

export interface BulkProductLocationStockInput {
  locationId: unknown;
  quantity?: unknown;
  minQty?: unknown;
  reorderQty?: unknown;
  zone?: unknown;
  bin?: unknown;
}

export interface BulkProductSaveVariantInput {
  clientId: string;
  variantId?: string;
  sku: unknown;
  barcode?: unknown;
  option1_name?: unknown;
  option1_value?: unknown;
  option2_name?: unknown;
  option2_value?: unknown;
  option3_name?: unknown;
  option3_value?: unknown;
  cost_aud?: unknown;
  price_rrp?: unknown;
  price_wholesale?: unknown;
  price_rrp_sale?: unknown;
  discount_start_date?: unknown;
  discount_end_date?: unknown;
  weight_kg?: unknown;
  cost_foreign?: unknown;
  is_active?: unknown;
  locationStock?: BulkProductLocationStockInput[];
}

export interface BulkProductSaveProductInput {
  clientId: string;
  productId?: string;
  name: unknown;
  base_sku: unknown;
  description?: unknown;
  product_type?: unknown;
  brand?: unknown;
  tags?: unknown;
  category?: unknown;
  subcategory?: unknown;
  style_code?: unknown;
  is_active?: unknown;
  is_stock_item?: unknown;
  is_online?: unknown;
  supplier_contact_id?: unknown;
  website_title?: unknown;
  allow_indent_wholesale?: unknown;
  variants: BulkProductSaveVariantInput[];
}

export interface BulkProductSaveError {
  clientId: string;
  field: string;
  message: string;
}

export class BulkProductValidationError extends Error {
  readonly errors: BulkProductSaveError[];

  constructor(errors: BulkProductSaveError[]) {
    super(errors[0]?.message || 'Product changes could not be validated.');
    this.name = 'BulkProductValidationError';
    this.errors = errors;
  }
}

interface BulkProductSaveDependencies {
  getConnection(): Promise<PoolConnection>;
  newId(): string;
  applyStocktake: typeof applyStocktakeInTransaction;
}

interface ExistingProductRow extends RowDataPacket {
  product_id: string;
  base_sku: string | null;
  is_stock_item: number;
}

interface ExistingVariantRow extends RowDataPacket {
  variant_id: string;
  product_id: string;
}

interface ExistingSupplierRow extends RowDataPacket {
  id: number;
}

interface ExistingLocationRow extends RowDataPacket {
  id: number;
}

interface IdentifierRow extends RowDataPacket {
  product_id: string;
  product_name: string;
  variant_id?: string;
  value: string;
}

const PRODUCT_COLUMNS = [
  'name', 'base_sku', 'description', 'product_type', 'brand', 'tags', 'category', 'subcategory',
  'style_code', 'is_active', 'is_stock_item', 'is_online', 'supplier_contact_id', 'website_title',
  'allow_indent_wholesale',
] as const;

const VARIANT_COLUMNS = [
  'sku', 'barcode', 'option1_name', 'option1_value', 'option2_name', 'option2_value',
  'option3_name', 'option3_value', 'cost_aud', 'price_rrp', 'price_wholesale', 'price_rrp_sale',
  'discount_start_date', 'discount_end_date', 'weight_kg', 'cost_foreign', 'is_active',
] as const;

const NUMERIC_VARIANT_FIELDS = new Set(['cost_aud', 'price_rrp', 'price_wholesale', 'price_rrp_sale', 'weight_kg']);
const BOOLEAN_PRODUCT_FIELDS = new Set(['is_active', 'is_stock_item', 'is_online', 'allow_indent_wholesale']);
const DATE_FIELDS = new Set(['discount_start_date', 'discount_end_date']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function booleanNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || Number(value) === 1 ? 1 : 0;
}

function nullableNumber(value: unknown, field: string, clientId: string, errors: BulkProductSaveError[]): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    errors.push({ clientId, field, message: `${field.replaceAll('_', ' ')} must be zero or greater.` });
    return null;
  }
  return number;
}

function normalizedDate(value: unknown, field: string, clientId: string, errors: BulkProductSaveError[]): string | null {
  if (value === undefined || value === null || value === '') return null;
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push({ clientId, field, message: `${field.replaceAll('_', ' ')} must be a valid date.` });
    return null;
  }
  return date;
}

function normalizedForeignCosts(value: unknown, clientId: string, errors: BulkProductSaveError[]): string | null {
  if (value === undefined || value === null || value === '') return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not an object');
    const normalized: Record<string, number> = {};
    for (const [currency, amount] of Object.entries(parsed as Record<string, unknown>)) {
      const number = Number(amount);
      if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(number) || number < 0) throw new Error('invalid cost');
      normalized[currency] = number;
    }
    return Object.keys(normalized).length ? JSON.stringify(normalized) : null;
  } catch {
    errors.push({ clientId, field: 'cost_foreign', message: 'Foreign costs must contain valid currency amounts.' });
    return null;
  }
}

function optionalNonnegativeNumber(
  value: unknown,
  field: string,
  clientId: string,
  errors: BulkProductSaveError[],
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    errors.push({ clientId, field, message: `${field.replaceAll('_', ' ')} must be zero or greater.` });
    return undefined;
  }
  return number;
}

function duplicateError(
  seen: Map<string, string>,
  value: string,
  clientId: string,
  field: string,
  label: string,
  errors: BulkProductSaveError[],
): void {
  if (!value) return;
  const key = value.toLowerCase();
  const earlier = seen.get(key);
  if (earlier && earlier !== clientId) {
    errors.push({ clientId, field, message: `${label} "${value}" is used more than once in these changes.` });
  } else {
    seen.set(key, clientId);
  }
}

export function createBulkProductSaveService(overrides: Partial<BulkProductSaveDependencies> = {}) {
  const dependencies: BulkProductSaveDependencies = {
    getConnection: () => getIMSPool().getConnection(),
    newId: randomUUID,
    applyStocktake: applyStocktakeInTransaction,
    ...overrides,
  };

  return async function saveBulkProducts(businessId: string, input: unknown) {
    const products = Array.isArray((input as { products?: unknown[] } | null)?.products)
      ? (input as { products: BulkProductSaveProductInput[] }).products
      : [];
    if (!products.length || products.length > 250) {
      throw new BulkProductValidationError([{ clientId: 'batch', field: 'products', message: 'Submit between 1 and 250 products.' }]);
    }

    const errors: BulkProductSaveError[] = [];
    const productSkuSeen = new Map<string, string>();
    const variantSkuSeen = new Map<string, string>();
    const barcodeSeen = new Map<string, string>();
    const normalizedProducts = products.map(product => {
      const clientId = text(product.clientId) || 'product';
      const name = text(product.name);
      const baseSku = text(product.base_sku);
      if (!name) errors.push({ clientId, field: 'name', message: 'Product Name is required.' });
      if (!baseSku) errors.push({ clientId, field: 'base_sku', message: 'Product SKU is required.' });
      if (isReservedShopifyFallbackSku(baseSku)) errors.push({ clientId, field: 'base_sku', message: 'SHOPIFY-MISC is reserved for the Shopify system fallback product.' });
      duplicateError(productSkuSeen, baseSku, clientId, 'base_sku', 'Product SKU', errors);
      if (!Array.isArray(product.variants) || !product.variants.length) {
        errors.push({ clientId, field: 'variants', message: 'At least one variant is required.' });
      }

      const normalizedVariants = (Array.isArray(product.variants) ? product.variants : []).map(variant => {
        const variantClientId = text(variant.clientId) || clientId;
        const variantId = text(variant.variantId) || undefined;
        const sku = text(variant.sku);
        const barcode = text(variant.barcode);
        if (!text(product.productId) && variantId) {
          errors.push({ clientId: variantClientId, field: 'variantId', message: 'An existing variant cannot be attached to a new product.' });
        }
        if (!sku) errors.push({ clientId: variantClientId, field: 'sku', message: 'Variant SKU is required.' });
        if (isReservedShopifyFallbackSku(sku)) errors.push({ clientId: variantClientId, field: 'sku', message: 'SHOPIFY-MISC is reserved for the Shopify system fallback product.' });
        duplicateError(variantSkuSeen, sku, variantClientId, 'sku', 'Variant SKU', errors);
        duplicateError(barcodeSeen, barcode, variantClientId, 'barcode', 'Barcode', errors);

        const values: Record<string, unknown> = {};
        for (const field of VARIANT_COLUMNS) {
          const value = variant[field];
          if (field === 'sku') values[field] = sku;
          else if (field === 'barcode') values[field] = nullableText(value);
          else if (field === 'is_active') values[field] = booleanNumber(value, 1);
          else if (NUMERIC_VARIANT_FIELDS.has(field)) values[field] = nullableNumber(value, field, variantClientId, errors);
          else if (DATE_FIELDS.has(field)) values[field] = normalizedDate(value, field, variantClientId, errors);
          else if (field === 'cost_foreign') values[field] = value === undefined ? undefined : normalizedForeignCosts(value, variantClientId, errors);
          else values[field] = nullableText(value);
        }
        const seenLocationIds = new Set<number>();
        const locationStock = (Array.isArray(variant.locationStock) ? variant.locationStock : []).map(raw => {
          const locationId = Number(raw.locationId);
          if (!Number.isInteger(locationId) || locationId <= 0) {
            errors.push({ clientId: variantClientId, field: 'location_stock', message: 'Location is invalid.' });
          }
          if (seenLocationIds.has(locationId)) errors.push({ clientId: variantClientId, field: `location_${locationId}`, message: 'Each location can be edited only once per variant.' });
          seenLocationIds.add(locationId);
          const fieldPrefix = `location_${locationId}`;
          const locationValues: { quantity?: number; minQty?: number; reorderQty?: number; zone?: string | null; bin?: string | null } = {};
          if ('quantity' in raw) locationValues.quantity = optionalNonnegativeNumber(raw.quantity, `${fieldPrefix}_soh`, variantClientId, errors);
          if ('minQty' in raw) locationValues.minQty = optionalNonnegativeNumber(raw.minQty, `${fieldPrefix}_min_qty`, variantClientId, errors);
          if ('reorderQty' in raw) locationValues.reorderQty = optionalNonnegativeNumber(raw.reorderQty, `${fieldPrefix}_reorder_qty`, variantClientId, errors);
          if ('zone' in raw) locationValues.zone = nullableText(raw.zone);
          if ('bin' in raw) locationValues.bin = nullableText(raw.bin);
          return { locationId, values: locationValues };
        }).filter(location => Object.keys(location.values).length > 0);
        return { clientId: variantClientId, variantId, values, locationStock };
      });

      const values: Record<string, unknown> = {};
      for (const field of PRODUCT_COLUMNS) {
        const value = product[field];
        if (field === 'name') values[field] = name;
        else if (field === 'base_sku') values[field] = baseSku;
        else if (BOOLEAN_PRODUCT_FIELDS.has(field)) values[field] = booleanNumber(value, field === 'is_online' ? 1 : field === 'allow_indent_wholesale' ? 0 : 1);
        else if (field === 'supplier_contact_id') values[field] = value === undefined || value === null || value === '' ? null : Number(value);
        else values[field] = nullableText(value);
      }
      if (values.supplier_contact_id !== null && (!Number.isInteger(values.supplier_contact_id) || Number(values.supplier_contact_id) <= 0)) {
        errors.push({ clientId, field: 'supplier_contact_id', message: 'Default Supplier is invalid.' });
      }
      return { clientId, productId: text(product.productId) || undefined, values, variants: normalizedVariants };
    });

    if (errors.length) throw new BulkProductValidationError(errors);

    const connection = await dependencies.getConnection();
    try {
      await connection.beginTransaction();

      for (const product of normalizedProducts) {
        if (product.values.supplier_contact_id !== null) {
          const [supplierRows] = await connection.execute<ExistingSupplierRow[]>(
            'SELECT id FROM ims_contacts WHERE business_id = ? AND id = ? LIMIT 1',
            [businessId, product.values.supplier_contact_id],
          );
          if (!supplierRows[0]) errors.push({ clientId: product.clientId, field: 'supplier_contact_id', message: 'Default Supplier was not found for this business.' });
        }
        if (product.productId) {
          const [rows] = await connection.execute<ExistingProductRow[]>(
            'SELECT product_id, base_sku, is_stock_item FROM ims_products WHERE business_id = ? AND product_id = ? FOR UPDATE',
            [businessId, product.productId],
          );
          if (!rows[0]) errors.push({ clientId: product.clientId, field: 'productId', message: 'Product was not found for this business.' });
          if (isReservedShopifyFallbackSku(rows[0]?.base_sku)) errors.push({ clientId: product.clientId, field: 'productId', message: 'Shopify Misc Charge is a protected system product.' });
        }
        for (const variant of product.variants) {
          if (!variant.variantId) continue;
          const [rows] = await connection.execute<ExistingVariantRow[]>(
            `SELECT v.variant_id, v.product_id
               FROM ims_product_variants v
               JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
              WHERE v.variant_id = ? AND v.product_id = ? FOR UPDATE`,
            [businessId, variant.variantId, product.productId ?? ''],
          );
          if (!rows[0]) errors.push({ clientId: variant.clientId, field: 'variantId', message: 'Variant was not found under this product.' });
        }
      }

      const allLocationIds = [...new Set(normalizedProducts.flatMap(product => product.variants.flatMap(variant => variant.locationStock.map(location => location.locationId))))];
      if (allLocationIds.length) {
        const [locationRows] = await connection.execute<ExistingLocationRow[]>(
          `SELECT id FROM ims_locations WHERE business_id = ? AND is_active = 1 AND id IN (${allLocationIds.map(() => '?').join(', ')})`,
          [businessId, ...allLocationIds],
        );
        const foundLocationIds = new Set(locationRows.map(location => Number(location.id)));
        for (const product of normalizedProducts) {
          for (const variant of product.variants) {
            for (const location of variant.locationStock) {
              if (!foundLocationIds.has(location.locationId)) errors.push({ clientId: variant.clientId, field: `location_${location.locationId}`, message: 'Location was not found for this business.' });
              if (location.values.quantity !== undefined && Number(product.values.is_stock_item) !== 1) {
                errors.push({ clientId: variant.clientId, field: `location_${location.locationId}_soh`, message: 'SOH can only be set for a product that tracks inventory.' });
              }
            }
          }
        }
        const [settingRows] = await connection.execute<RowDataPacket[]>(
          "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN ('product_allow_opening_stock', 'use_zones_bins')",
          [businessId],
        );
        const featureSettings = new Map(settingRows.map(row => [String(row.key), String(row.value)]));
        const allowSoh = (featureSettings.get('product_allow_opening_stock') ?? 'yes') === 'yes';
        const allowZonesBins = (featureSettings.get('use_zones_bins') ?? 'no') === 'yes';
        for (const product of normalizedProducts) for (const variant of product.variants) for (const location of variant.locationStock) {
          if (location.values.quantity !== undefined && !allowSoh) errors.push({ clientId: variant.clientId, field: `location_${location.locationId}_soh`, message: 'SOH editing is disabled in Product settings.' });
          if ((location.values.zone !== undefined || location.values.bin !== undefined) && !allowZonesBins) errors.push({ clientId: variant.clientId, field: `location_${location.locationId}_zone`, message: 'Zones and bins are disabled in settings.' });
        }
      }

      for (const product of normalizedProducts) {
        const [rows] = await connection.execute<IdentifierRow[]>(
          `SELECT product_id, name AS product_name, base_sku AS value
             FROM ims_products
            WHERE business_id = ? AND LOWER(TRIM(base_sku)) = LOWER(?) AND product_id <> ? LIMIT 1`,
          [businessId, product.values.base_sku, product.productId ?? ''],
        );
        if (rows[0]) errors.push({ clientId: product.clientId, field: 'base_sku', message: `Product SKU "${product.values.base_sku}" is already used by product "${rows[0].product_name}".` });
        for (const variant of product.variants) {
          for (const [field, column, label] of [['sku', 'sku', 'Variant SKU'], ['barcode', 'barcode', 'Barcode']] as const) {
            const value = variant.values[field];
            if (!value) continue;
            const [identifierRows] = await connection.execute<IdentifierRow[]>(
              `SELECT v.product_id, p.name AS product_name, v.variant_id, v.${column} AS value
                 FROM ims_product_variants v
                 JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
                WHERE LOWER(TRIM(v.${column})) = LOWER(?) AND v.variant_id <> ? LIMIT 1`,
              [businessId, value, variant.variantId ?? ''],
            );
            if (identifierRows[0]) errors.push({ clientId: variant.clientId, field, message: `${label} "${value}" is already used by product "${identifierRows[0].product_name}".` });
          }
        }
      }

      if (errors.length) throw new BulkProductValidationError(errors);

      const mappings: Array<{ clientId: string; productId: string; variants: Array<{ clientId: string; variantId: string }> }> = [];
      const stocktakeLinesByLocation = new Map<number, Array<{ variantId: string; quantity: number }>>();
      let created = 0;
      let updated = 0;
      for (const product of normalizedProducts) {
        const productId = product.productId ?? dependencies.newId();
        if (product.productId) {
          const assignments = PRODUCT_COLUMNS.map(field => `${field} = ?`).join(', ');
          await connection.execute(
            `UPDATE ims_products SET ${assignments} WHERE business_id = ? AND product_id = ?`,
            [...PRODUCT_COLUMNS.map(field => product.values[field]), businessId, productId],
          );
          updated += 1;
        } else {
          await connection.execute(
            `INSERT INTO ims_products (business_id, product_id, ${PRODUCT_COLUMNS.join(', ')}) VALUES (?, ?, ${PRODUCT_COLUMNS.map(() => '?').join(', ')})`,
            [businessId, productId, ...PRODUCT_COLUMNS.map(field => product.values[field])],
          );
          created += 1;
        }

        const variantMappings: Array<{ clientId: string; variantId: string }> = [];
        for (const variant of product.variants) {
          const variantId = variant.variantId ?? dependencies.newId();
          if (variant.variantId) {
            const updateColumns = VARIANT_COLUMNS.filter(field => field !== 'cost_foreign' || variant.values[field] !== undefined);
            const assignments = updateColumns.map(field => `${field} = ?`).join(', ');
            await connection.execute(
              `UPDATE ims_product_variants SET ${assignments} WHERE business_id = ? AND product_id = ? AND variant_id = ?`,
              [...updateColumns.map(field => variant.values[field]), businessId, productId, variantId],
            );
          } else {
            await connection.execute(
              `INSERT INTO ims_product_variants (business_id, product_id, variant_id, ${VARIANT_COLUMNS.join(', ')}) VALUES (?, ?, ?, ${VARIANT_COLUMNS.map(() => '?').join(', ')})`,
              [businessId, productId, variantId, ...VARIANT_COLUMNS.map(field => variant.values[field] ?? null)],
            );
          }
          for (const location of variant.locationStock) {
            const metadataEntries = [
              ['min_qty', location.values.minQty],
              ['reorder_qty', location.values.reorderQty],
              ['zone', location.values.zone],
              ['bin', location.values.bin],
            ].filter((entry): entry is [string, number | string | null] => entry[1] !== undefined);
            if (metadataEntries.length) {
              const columns = metadataEntries.map(([column]) => column);
              await connection.execute(
                `INSERT INTO ims_stock (business_id, variant_id, location_id, ${columns.join(', ')})
                 VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})
                 ON DUPLICATE KEY UPDATE ${columns.map(column => `${column} = VALUES(${column})`).join(', ')}`,
                [businessId, variantId, location.locationId, ...metadataEntries.map(([, entryValue]) => entryValue)],
              );
            }
            if (location.values.quantity !== undefined) {
              const lines = stocktakeLinesByLocation.get(location.locationId) ?? [];
              lines.push({ variantId, quantity: location.values.quantity });
              stocktakeLinesByLocation.set(location.locationId, lines);
            }
          }
          variantMappings.push({ clientId: variant.clientId, variantId });
        }
        mappings.push({ clientId: product.clientId, productId, variants: variantMappings });
      }

      const requestToken = text((input as { requestToken?: unknown }).requestToken);
      if (stocktakeLinesByLocation.size && !/^[a-zA-Z0-9-]{8,100}$/.test(requestToken)) {
        throw new BulkProductValidationError([{ clientId: 'batch', field: 'requestToken', message: 'A valid stock edit request token is required.' }]);
      }
      for (const [locationId, lines] of stocktakeLinesByLocation) {
        const reference = `BULK-PRODUCT-${requestToken.slice(0, 48)}-${locationId}`.slice(0, 100);
        const [stocktakeResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ims_stocktakes (business_id, reference, location_id, status, notes)
           VALUES (?, ?, ?, 'in_progress', 'SOH counted through Bulk Add/Edit Products')`,
          [businessId, reference, locationId],
        );
        const stocktakeId = Number(stocktakeResult.insertId);
        for (const line of lines) {
          await connection.execute(
            `INSERT INTO ims_stocktake_items (stocktake_id, variant_id, expected_qty, counted_qty, notes)
             SELECT ?, v.variant_id, COALESCE(s.qty_on_hand, 0), ?, 'SOH count from Bulk Add/Edit Products'
               FROM ims_product_variants v
               LEFT JOIN ims_stock s ON s.business_id = v.business_id AND s.variant_id = v.variant_id AND s.location_id = ?
              WHERE v.business_id = ? AND v.variant_id = ?`,
            [stocktakeId, line.quantity, locationId, businessId, line.variantId],
          );
        }
        const requestHash = await hashInventoryDocumentRequest({ locationId, lines });
        await dependencies.applyStocktake(connection, {
          businessId,
          stocktakeId,
          context: { operationKey: `bulk-product-stocktake-${requestToken}-${locationId}`, requestHash },
        });
      }

      await connection.commit();
      return { success: true as const, created, updated, mappings, stockVariantIds: [...new Set([...stocktakeLinesByLocation.values()].flat().map(line => line.variantId))] };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
}

export const saveBulkProducts = createBulkProductSaveService();