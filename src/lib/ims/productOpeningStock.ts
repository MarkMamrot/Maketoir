import { ImsStocktakeRepo } from './ImsRepository';
import { hashInventoryDocumentRequest } from './inventoryDocumentLifecycle';
import { applyStocktake, transitionStocktake } from './stocktakes/stocktakeOperations';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export interface ProductOpeningStockLine {
  variantId: string;
  locationId: number;
  quantity: number;
  minQty: number;
  reorderQty: number;
}

interface ProductOpeningStockInput {
  businessId: string;
  productId: string;
  requestToken: string;
  lines: ProductOpeningStockLine[];
  actorId?: number | null;
  actorName?: string | null;
}

export class ProductOpeningStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductOpeningStockError';
  }
}

export function normalizeProductOpeningStockLines(rawLines: unknown): ProductOpeningStockLine[] {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new ProductOpeningStockError('At least one opening stock line is required.');
  if (rawLines.length > 5000) throw new ProductOpeningStockError('Opening stock is limited to 5,000 variant and location entries.');

  const seen = new Set<string>();
  return rawLines.map((raw: any) => {
    const variantId = String(raw?.variantId ?? '').trim();
    const locationId = Number(raw?.locationId);
    const quantity = Number(raw?.quantity ?? 0);
    const minQty = Number(raw?.minQty ?? 0);
    const reorderQty = Number(raw?.reorderQty ?? 0);
    if (!variantId || !Number.isInteger(locationId) || locationId <= 0) {
      throw new ProductOpeningStockError('Every opening stock entry requires a valid variant and location.');
    }
    if (![quantity, minQty, reorderQty].every(value => Number.isFinite(value) && value >= 0)) {
      throw new ProductOpeningStockError('Opening, minimum and reorder quantities must be zero or greater.');
    }
    const key = `${variantId}:${locationId}`;
    if (seen.has(key)) throw new ProductOpeningStockError('Each variant and location can appear only once.');
    seen.add(key);
    return { variantId, locationId, quantity, minQty, reorderQty };
  });
}

export async function applyProductOpeningStock(input: ProductOpeningStockInput) {
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(input.requestToken)) throw new ProductOpeningStockError('A valid opening stock request token is required.');
  const lines = normalizeProductOpeningStockLines(input.lines);
  const productRows = await imsQuery<{ product_id: string; is_stock_item: number }>(
    'SELECT product_id, is_stock_item FROM ims_products WHERE business_id = ? AND product_id = ? LIMIT 1',
    [input.businessId, input.productId],
  );
  if (!productRows[0]) throw new ProductOpeningStockError('Product not found.');
  if (Number(productRows[0].is_stock_item) !== 1) throw new ProductOpeningStockError('Opening stock can only be added to a product that tracks inventory.');

  const variantIds = [...new Set(lines.map(line => line.variantId))];
  const variants = await imsQuery<{ variant_id: string }>(
    `SELECT variant_id FROM ims_product_variants
      WHERE business_id = ? AND product_id = ? AND variant_id IN (${variantIds.map(() => '?').join(',')})`,
    [input.businessId, input.productId, ...variantIds],
  );
  if (variants.length !== variantIds.length) throw new ProductOpeningStockError('One or more variants do not belong to this product.');

  const locationIds = [...new Set(lines.map(line => line.locationId))];
  const locations = await imsQuery<{ id: number; name: string }>(
    `SELECT id, name FROM ims_locations
      WHERE business_id = ? AND is_active = 1 AND id IN (${locationIds.map(() => '?').join(',')})`,
    [input.businessId, ...locationIds],
  );
  if (locations.length !== locationIds.length) throw new ProductOpeningStockError('One or more locations are not active for this business.');

  const locationNames = new Map(locations.map(location => [Number(location.id), location.name]));
  const results = [];
  for (const locationId of locationIds) {
    const locationLines = lines
      .filter(line => line.locationId === locationId)
      .sort((left, right) => left.variantId.localeCompare(right.variantId));
    const requestHash = await hashInventoryDocumentRequest({ productId: input.productId, locationId, lines: locationLines });
    const reference = `PRODUCT-OPEN-${input.productId.slice(0, 12)}-${input.requestToken.slice(0, 24)}-${locationId}`.slice(0, 100);
    const existing = await imsQuery<{ id: number; status: string }>(
      `SELECT id, status FROM ims_stocktakes
        WHERE business_id = ? AND location_id = ? AND reference = ?
        ORDER BY id DESC LIMIT 1`,
      [input.businessId, locationId, reference],
    );
    let stocktakeId = existing[0]?.id;
    if (!stocktakeId) {
      stocktakeId = await ImsStocktakeRepo.create({
        reference,
        location_id: locationId,
        notes: `Opening stock added while creating product ${input.productId} at ${locationNames.get(locationId)}.`,
        blank: true,
      }, input.businessId);
    }

    await transitionStocktake({
      businessId: input.businessId,
      stocktakeId,
      action: 'start',
      context: {
        operationKey: `product-opening-start-${input.requestToken}-${locationId}`,
        requestHash,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
      },
    });

    if (existing[0]?.status !== 'completed') {
      for (const line of locationLines) {
        await imsExecute(
          `INSERT INTO ims_stocktake_items (stocktake_id, variant_id, expected_qty, counted_qty, notes)
           SELECT ?, v.variant_id, COALESCE(s.qty_on_hand, 0), ?, 'Opening stock from product creation'
             FROM ims_product_variants v
             LEFT JOIN ims_stock s ON s.business_id = v.business_id AND s.variant_id = v.variant_id AND s.location_id = ?
            WHERE v.business_id = ? AND v.product_id = ? AND v.variant_id = ?
           ON DUPLICATE KEY UPDATE counted_qty = VALUES(counted_qty), notes = VALUES(notes)`,
          [stocktakeId, line.quantity, locationId, input.businessId, input.productId, line.variantId],
        );
        await imsExecute(
          `INSERT INTO ims_stock (business_id, variant_id, location_id, min_qty, reorder_qty)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE min_qty = VALUES(min_qty), reorder_qty = VALUES(reorder_qty)`,
          [input.businessId, line.variantId, locationId, line.minQty, line.reorderQty],
        );
      }
    }

    const result = await applyStocktake({
      businessId: input.businessId,
      stocktakeId,
      context: {
        operationKey: `product-opening-apply-${input.requestToken}-${locationId}`,
        requestHash,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
      },
    });
    results.push({ locationId, stocktakeId, ...result });
  }
  return { productId: input.productId, locations: results };
}