import type { PoolConnection } from 'mysql2/promise';
import { createHash } from 'crypto';
import { ConsignmentConflict, resolveCurrentOwnership } from './ownership';
import { getTrackingInterval, lockTrackingState } from './tracking';

export type SourceFact = {
  businessId: string; supplierId: number; sourceType: 'sale' | 'refund' | 'refund_reversal' | 'supplier_return' | 'correction';
  sourceId: number; sourceLineId: number; eventKey: string; originalEventId?: number | null;
  variantId: string; sku?: string | null; productName?: string | null; locationId: number;
  channel: string; eventDate: string; quantity: number; unitCost: number | null; taxRate: number | null;
  exception?: string | null;
};

export function sourceEventKey(key: string): string {
  return key.length <= 191 ? key : `sha256:${createHash('sha256').update(key).digest('hex')}`;
}

export function validateSourceFact(fact: SourceFact) {
  if (!fact.businessId || !fact.variantId || !fact.eventKey || !Number.isSafeInteger(fact.supplierId) || fact.supplierId <= 0
    || !Number.isSafeInteger(fact.sourceId) || fact.sourceId <= 0 || !Number.isSafeInteger(fact.sourceLineId) || fact.sourceLineId <= 0) {
    throw new ConsignmentConflict('Consignment source identity must be complete and immutable.');
  }
  if (!Number.isFinite(fact.quantity) || fact.quantity === 0) throw new ConsignmentConflict('Consignment events require a non-zero item quantity.');
  if ((fact.sourceType === 'sale' || fact.sourceType === 'refund_reversal') && fact.quantity < 0
    || fact.sourceType === 'refund' && fact.quantity > 0
    || fact.sourceType === 'supplier_return' && fact.quantity > 0 && !fact.originalEventId) {
    throw new ConsignmentConflict('Invalid consignment quantity direction.');
  }
  if (fact.unitCost === null || !Number.isFinite(fact.unitCost) || fact.unitCost < 0
    || fact.taxRate === null || !Number.isFinite(fact.taxRate) || fact.taxRate < 0) {
    throw new ConsignmentConflict('Consignment requires original, known supplier cost and tax evidence; no estimated or zeroed cost is permitted.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fact.eventDate) || !Number.isFinite(Date.parse(`${fact.eventDate}T00:00:00Z`))
    || new Date(`${fact.eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== fact.eventDate) throw new ConsignmentConflict('A valid consignment business date is required.');
}

/** Facts are captured even with tracking off. Tracking annotates new facts only, never backfills a debt. */
export async function captureSourceFact(db: PoolConnection, fact: SourceFact) {
  fact = { ...fact, eventKey: sourceEventKey(fact.eventKey) };
  validateSourceFact(fact);
  const intervalId = await getTrackingInterval(db, fact.businessId, fact.eventDate);
  let exception = fact.exception ?? null;
  if (fact.originalEventId) {
    const [[original]] = await db.execute<any[]>(
      'SELECT tracking_interval_id FROM ims_consignment_events WHERE id = ? AND business_id = ? FOR UPDATE',
      [fact.originalEventId, fact.businessId],
    );
    if (!original) throw new ConsignmentConflict('Original consignment source evidence was not found.');
    if (fact.sourceType !== 'supplier_return' && (original.tracking_interval_id == null ? null : Number(original.tracking_interval_id)) !== intervalId) {
      exception = 'Cross-cutover refund requires manual review';
    }
  }
  const [existing] = await db.execute<any[]>(
    'SELECT * FROM ims_consignment_events WHERE business_id = ? AND event_key = ? FOR UPDATE',
    [fact.businessId, fact.eventKey],
  );
  if (existing.length) {
    const row = existing[0];
    if (Number(row.supplier_id) !== fact.supplierId || Number(row.quantity) !== fact.quantity
      || Number(row.unit_cost) !== fact.unitCost || String(row.variant_id) !== fact.variantId
      || Number(row.tax_rate) !== fact.taxRate || String(row.source_type) !== fact.sourceType
      || Number(row.source_id) !== fact.sourceId || Number(row.source_line_id) !== fact.sourceLineId) {
      throw new ConsignmentConflict('A consignment source retry conflicts with its immutable snapshot.');
    }
    return Number(row.id);
  }
  const [result] = await db.execute<any>(
    `INSERT INTO ims_consignment_events
      (business_id,supplier_id,source_type,source_id,source_line_id,event_key,original_event_id,
       variant_id,sku,product_name,location_id,channel,event_date,quantity,unit_cost,tax_rate,
       tracking_interval_id,statement_id,exception)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
    [fact.businessId, fact.supplierId, fact.sourceType, fact.sourceId, fact.sourceLineId, fact.eventKey,
      fact.originalEventId ?? null, fact.variantId, fact.sku ?? null, fact.productName ?? null,
      fact.locationId, fact.channel, fact.eventDate, fact.quantity, fact.unitCost, fact.taxRate, intervalId, exception],
  );
  return Number(result.insertId);
}

export async function captureConsignmentSale(db: PoolConnection, input: {
  businessId: string; sourceId: number; sourceLineId: number; eventKey: string; variantId: string;
  locationId: number; channel: string; eventDate: string; quantity: number; unitCost?: number | null; stockMovementId?: number;
}) {
  const ownership = await resolveCurrentOwnership(db, input.businessId, input.variantId);
  if (ownership.ownership !== 'consignment') return;
  const [[history]] = await db.execute<any[]>(
    `SELECT DATE_FORMAT(h.effective_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS effective_at
       FROM ims_consignment_ownership_history h
       JOIN ims_product_variants v ON v.product_id = h.product_id AND v.business_id = h.business_id
      WHERE h.business_id = ? AND v.variant_id = ?
      ORDER BY h.effective_at DESC,h.id DESC LIMIT 1`, [input.businessId, input.variantId],
  );
  if (!history?.effective_at || input.eventDate < new Date(history.effective_at).toLocaleDateString('sv-SE', { timeZone: process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney' })) {
    throw new ConsignmentConflict('This sale predates reliable consignment ownership evidence. Historical or imported activity requires a separately reviewed correction.');
  }
  const [[variant]] = await db.execute<any[]>(
    `SELECT v.sku, p.name,
            EXISTS(SELECT 1 FROM ims_stock s WHERE s.variant_id = v.variant_id
              AND s.business_id = v.business_id AND s.location_id = ? AND s.qty_on_hand < 0) AS negative_stock
       FROM ims_product_variants v JOIN ims_products p ON p.product_id = v.product_id
       JOIN ims_contacts c ON c.id = p.supplier_contact_id AND c.business_id = p.business_id
      WHERE v.variant_id = ? AND v.business_id = ? FOR UPDATE`, [input.locationId, input.variantId, input.businessId],
  );
  if (!variant) throw new ConsignmentConflict('Consignment supplier evidence is missing.');
  if (Number(variant.negative_stock)) throw new ConsignmentConflict('Consignment cannot be sold or fulfilled into negative stock. Reconcile available supplier stock before retrying.');
  const [[receipt]] = await db.execute<any[]>(
    `SELECT MIN(CASE WHEN po.tax_treatment = 'no_tax' THEN 0 ELSE i.tax_rate END) AS supplier_tax_rate,
            COUNT(DISTINCT CASE WHEN po.tax_treatment = 'no_tax' THEN 0 ELSE i.tax_rate END) AS tax_rates,
            MIN(m.unit_cost) AS minimum_received_cost
       FROM ims_stock_movements m
       JOIN ims_purchase_orders po ON po.id = m.reference_id AND po.business_id = m.business_id
       JOIN ims_purchase_order_items i ON i.po_id = po.id AND i.variant_id = m.variant_id
      WHERE m.business_id = ? AND m.variant_id = ? AND m.reference_type = 'purchase_order'
        AND m.movement_type = 'po_received' AND m.qty_change > 0 AND m.consignment_supplier_id = ?`,
    [input.businessId, input.variantId, ownership.supplierId],
  );
  if (!receipt || Number(receipt.tax_rates) !== 1 || receipt.supplier_tax_rate == null) {
    throw new ConsignmentConflict('Consignment requires unambiguous received supplier tax evidence. Missing or mixed receipt tax rates require manual review.');
  }
  let unitCost = input.unitCost ?? null;
  if (input.stockMovementId) {
    const [[movement]] = await db.execute<any[]>('SELECT unit_cost FROM ims_stock_movements WHERE id = ? AND business_id = ?', [input.stockMovementId, input.businessId]);
    unitCost = movement?.unit_cost == null ? null : Number(movement.unit_cost);
  }
  if (unitCost === 0 && Number(receipt.minimum_received_cost) > 0) throw new ConsignmentConflict('The zero sale cost conflicts with received supplier costs. Reconcile the stock cost before selling consignment stock.');
  await captureSourceFact(db, {
    ...input, supplierId: ownership.supplierId!, sourceType: 'sale',
    sku: variant.sku, productName: variant.name,
    unitCost,
    taxRate: Number(receipt.supplier_tax_rate) * 100,
  });
}

/** Allocate linked returns across original shipments, preserving every shipment's original cost/tax. */
export async function captureConsignmentRefund(db: PoolConnection, input: {
  businessId: string; sourceId: number; sourceLineId: number; sourceChannel: 'pos' | 'sales_order';
  originalSourceId: number; originalSourceLineId: number; variantId: string; locationId: number;
  eventDate: string; quantity: number; eventKey: string;
}) {
  const sourceSql = `SELECT * FROM ims_consignment_events WHERE business_id = ? AND source_type = 'sale'
      AND source_id = ? AND source_line_id = ? AND ${input.sourceChannel === 'pos' ? "channel = 'pos'" : "channel IN ('online','wholesale')"}
      ORDER BY id`;
  let [originals] = await db.execute<any[]>(
    sourceSql, [input.businessId, input.originalSourceId, input.originalSourceLineId],
  );
  if (!originals.length) {
    const owner = await resolveCurrentOwnership(db, input.businessId, input.variantId);
    if (owner.ownership === 'consignment') throw new ConsignmentConflict('This return has no original consignment sale evidence. Historical/imported or unlinked returns require manual review.');
    return;
  }
  await lockTrackingState(db, input.businessId);
  [originals] = await db.execute<any[]>(`${sourceSql} FOR UPDATE`, [input.businessId, input.originalSourceId, input.originalSourceLineId]);
  let remaining = Math.abs(input.quantity);
  if (!Number.isFinite(remaining) || remaining <= 0) throw new ConsignmentConflict('A consignment refund requires an explicit positive refunded quantity.');
  for (const original of originals) {
    const eventKey = sourceEventKey(`${input.eventKey}:${original.id}`);
    const [[retry]] = await db.execute<any[]>('SELECT id, quantity FROM ims_consignment_events WHERE business_id = ? AND event_key = ? FOR UPDATE', [input.businessId, eventKey]);
    if (retry) { remaining -= Math.abs(Number(retry.quantity)); continue; }
    const [[adjustments]] = await db.execute<any[]>(
      `SELECT COALESCE(SUM(quantity),0) AS quantity FROM ims_consignment_events
        WHERE business_id = ? AND original_event_id = ? AND source_type IN ('refund','refund_reversal')`,
      [input.businessId, original.id],
    );
    const available = Number(original.quantity) + Number(adjustments?.quantity ?? 0);
    const quantity = Math.min(remaining, Math.max(0, available));
    if (quantity <= 0) continue;
    if (String(original.variant_id) !== input.variantId) throw new ConsignmentConflict('The refunded product differs from the original consignment source.');
    await captureSourceFact(db, {
      businessId: input.businessId, supplierId: Number(original.supplier_id), sourceType: 'refund',
      sourceId: input.sourceId, sourceLineId: input.sourceLineId, eventKey, originalEventId: Number(original.id),
      variantId: input.variantId, sku: original.sku, productName: original.product_name, locationId: input.locationId,
      channel: original.channel, eventDate: input.eventDate, quantity: -quantity,
      unitCost: original.unit_cost == null ? null : Number(original.unit_cost),
      taxRate: original.tax_rate == null ? null : Number(original.tax_rate),
    });
    remaining -= quantity;
    if (remaining < 0.00005) return;
  }
  if (remaining > 0.00005) throw new ConsignmentConflict('Refunded quantity exceeds the remaining original consignment sale evidence.');
}

export async function reverseConsignmentRefunds(db: PoolConnection, input: {
  businessId: string; sourceId: number; channel: 'pos' | 'sales_order'; eventDate: string; eventKey: string;
}) {
  const sourceSql = `SELECT * FROM ims_consignment_events WHERE business_id = ? AND source_id = ? AND source_type = 'refund'
      AND ${input.channel === 'pos' ? "channel = 'pos'" : "channel IN ('online','wholesale')"}`;
  let [refunds] = await db.execute<any[]>(
    sourceSql,
    [input.businessId, input.sourceId],
  );
  if (!refunds.length) return;
  await lockTrackingState(db, input.businessId);
  [refunds] = await db.execute<any[]>(`${sourceSql} FOR UPDATE`, [input.businessId, input.sourceId]);
  for (const refund of refunds) {
    await captureSourceFact(db, {
      businessId: input.businessId, supplierId: Number(refund.supplier_id), sourceType: 'refund_reversal',
      sourceId: input.sourceId, sourceLineId: Number(refund.source_line_id), eventKey: `${input.eventKey}:${refund.id}`,
      originalEventId: Number(refund.original_event_id), variantId: refund.variant_id, sku: refund.sku,
      productName: refund.product_name, locationId: Number(refund.location_id), channel: refund.channel,
      eventDate: input.eventDate, quantity: -Number(refund.quantity),
      unitCost: refund.unit_cost == null ? null : Number(refund.unit_cost), taxRate: refund.tax_rate == null ? null : Number(refund.tax_rate),
    });
  }
}

export async function assertConsignmentPosMutationAllowed(
  db: PoolConnection, businessId: string, saleId: number, mutation: 'edit' | 'void_sale' | 'void_refund',
) {
  const [[fact]] = await db.execute<any[]>('SELECT id FROM ims_consignment_events WHERE business_id = ? AND source_id = ? AND channel = ? LIMIT 1 FOR UPDATE', [businessId, saleId, 'pos']);
  if (fact && mutation === 'void_refund') throw new ConsignmentConflict('A consignment POS refund cannot be voided automatically because its linked credit note, stock and tender must be corrected together. Request a reviewed refund reversal.');
  if (fact && mutation !== 'void_refund') throw new ConsignmentConflict('Completed consignment source facts cannot be edited or voided. Use a linked quantity return and a new sale.');
  return Boolean(fact);
}

export async function reverseConsignmentSupplierReturn(db: PoolConnection, businessId: string, sourceId: number, eventDate: string) {
  const [facts] = await db.execute<any[]>('SELECT * FROM ims_consignment_events WHERE business_id = ? AND source_id = ? AND source_type = ? AND quantity < 0', [businessId, sourceId, 'supplier_return']);
  if (!facts.length) return;
  await lockTrackingState(db, businessId);
  for (const fact of facts) await captureSourceFact(db, {
    businessId, supplierId: Number(fact.supplier_id), sourceType: 'supplier_return',
    sourceId, sourceLineId: Number(fact.source_line_id), eventKey: `supplier-return-reversal:${sourceId}:${fact.id}`,
    originalEventId: Number(fact.id), variantId: fact.variant_id, sku: fact.sku, productName: fact.product_name,
    locationId: Number(fact.location_id), channel: 'supplier_return', eventDate, quantity: -Number(fact.quantity),
    unitCost: fact.unit_cost == null ? null : Number(fact.unit_cost), taxRate: fact.tax_rate == null ? null : Number(fact.tax_rate),
  });
}
