import { randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getIMSPool } from '@/services/IMSMySQLService';
import { isReservedShopifyFallbackSku } from '@/lib/shopifyFallbackVariant';

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
}

interface ExistingProductRow extends RowDataPacket {
  product_id: string;
  base_sku: string | null;
}

interface ExistingVariantRow extends RowDataPacket {
  variant_id: string;
  product_id: string;
}

interface ExistingSupplierRow extends RowDataPacket {
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
        const sku = text(variant.sku);
        const barcode = text(variant.barcode);
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
          else if (field === 'cost_foreign') values[field] = normalizedForeignCosts(value, variantClientId, errors);
          else values[field] = nullableText(value);
        }
        return { clientId: variantClientId, variantId: text(variant.variantId) || undefined, values };
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
            'SELECT product_id, base_sku FROM ims_products WHERE business_id = ? AND product_id = ? FOR UPDATE',
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
            const assignments = VARIANT_COLUMNS.map(field => `${field} = ?`).join(', ');
            await connection.execute(
              `UPDATE ims_product_variants SET ${assignments} WHERE business_id = ? AND product_id = ? AND variant_id = ?`,
              [...VARIANT_COLUMNS.map(field => variant.values[field]), businessId, productId, variantId],
            );
          } else {
            await connection.execute(
              `INSERT INTO ims_product_variants (business_id, product_id, variant_id, ${VARIANT_COLUMNS.join(', ')}) VALUES (?, ?, ?, ${VARIANT_COLUMNS.map(() => '?').join(', ')})`,
              [businessId, productId, variantId, ...VARIANT_COLUMNS.map(field => variant.values[field])],
            );
          }
          variantMappings.push({ clientId: variant.clientId, variantId });
        }
        mappings.push({ clientId: product.clientId, productId, variants: variantMappings });
      }

      await connection.commit();
      return { success: true as const, created, updated, mappings };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
}

export const saveBulkProducts = createBulkProductSaveService();