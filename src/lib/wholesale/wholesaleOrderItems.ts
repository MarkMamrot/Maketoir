import { imsQuery } from '@/services/IMSMySQLService';
import { isWholesaleBrandAllowed, type WholesaleBrandAccess } from './wholesaleAccess';

export class WholesaleItemValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WholesaleItemValidationError';
  }
}

export async function validateWholesaleOrderItems(
  businessId: string,
  access: WholesaleBrandAccess,
  rawItems: unknown,
) {
  if (!Array.isArray(rawItems)) throw new WholesaleItemValidationError('Order items must be an array.');
  if (rawItems.length === 0) return [];
  if (rawItems.length > 500) throw new WholesaleItemValidationError('An order cannot contain more than 500 lines.');

  const requested = rawItems.map((raw: any) => {
    const variantId = String(raw?.variant_id ?? '').trim();
    const qty = Number(raw?.qty);
    if (!variantId || !Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      throw new WholesaleItemValidationError('Every order line requires a valid variant and whole-number quantity.');
    }
    return { variantId, qty };
  });
  if (new Set(requested.map(item => item.variantId)).size !== requested.length) {
    throw new WholesaleItemValidationError('Duplicate variants must be combined into one order line.');
  }

  const placeholders = requested.map(() => '?').join(',');
  const rows = await imsQuery<{
    variant_id: string; product_id: string; product_name: string; brand: string | null;
    sku: string | null; option1_value: string | null; option2_value: string | null; option3_value: string | null;
    price_wholesale: number;
  }>(
    `SELECT v.variant_id, v.product_id, p.name AS product_name, p.brand, v.sku,
            v.option1_value, v.option2_value, v.option3_value, v.price_wholesale
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
      WHERE v.variant_id IN (${placeholders})
        AND v.is_active = 1 AND p.is_active = 1 AND v.price_wholesale > 0`,
    [businessId, ...requested.map(item => item.variantId)],
  );
  const byVariant = new Map(rows.map(row => [row.variant_id, row]));

  return requested.map(item => {
    const row = byVariant.get(item.variantId);
    if (!row) throw new WholesaleItemValidationError('One or more products are no longer available for wholesale ordering.');
    if (!isWholesaleBrandAllowed(access, row.brand)) {
      throw new WholesaleItemValidationError(`${row.product_name} is not available for this wholesale account.`);
    }
    const unitPrice = Number(row.price_wholesale);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new WholesaleItemValidationError(`${row.product_name} no longer has a valid wholesale price.`);
    }
    return {
      variant_id: row.variant_id,
      product_id: row.product_id,
      product_name: row.product_name,
      variant_label: [row.option1_value, row.option2_value, row.option3_value].filter(Boolean).join(' / ') || null,
      sku: row.sku,
      qty: item.qty,
      unit_price: unitPrice,
      is_indent: false,
      indent_qty: 0,
    };
  });
}