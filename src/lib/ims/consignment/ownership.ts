import type { PoolConnection } from 'mysql2/promise';
import { lockInventoryCostState } from '../costing/fifoCostingService';

export class ConsignmentConflict extends Error {
  readonly status = 409;
  constructor(message: string) { super(message); this.name = 'ConsignmentConflict'; }
}

export type Ownership = { supplierId: number | null; ownership: 'owned' | 'consignment' | 'unknown' };
export type OwnershipActor = { isAdmin: boolean; actorId?: number | null };

export function assertConsignmentProductSupported(product: {
  is_stock_item?: unknown; uses_builds?: unknown; product_type?: unknown;
}) {
  if (Number(product.is_stock_item ?? 1) !== 1 || Number(product.uses_builds ?? 0) === 1
    || /build|assembly|kit/i.test(String(product.product_type ?? ''))) {
    throw new ConsignmentConflict('Consignment supports stock products only, not builds, components, assemblies or non-stock items.');
  }
}

/** Call inside the stock/document owner's transaction. Product and supplier locks prevent relabelling mid-operation. */
export async function resolveCurrentOwnership(db: PoolConnection, businessId: string, variantId: string): Promise<Ownership> {
  const [rows] = await db.execute<any[]>(
    `SELECT p.id, p.product_id, p.is_stock_item, p.uses_builds, p.product_type,
            p.supplier_contact_id, c.is_consignment
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = v.business_id
       LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id AND c.business_id = p.business_id
      WHERE v.variant_id = ? AND v.business_id = ? FOR UPDATE`,
    [variantId, businessId],
  );
  const row = rows[0];
  if (!row) return { supplierId: null, ownership: 'unknown' };
  if (Number(row.is_consignment) !== 1) return { supplierId: null, ownership: 'owned' };
  assertConsignmentProductSupported(row);
  const [recipes] = await db.execute<any[]>(
    `SELECT r.id FROM ims_product_build_recipe_components r
       WHERE r.component_variant_id = ? AND r.business_id = ? LIMIT 1`, [variantId, businessId],
  );
  if (recipes.length) throw new ConsignmentConflict('Consignment build components are not supported.');
  return { supplierId: Number(row.supplier_contact_id), ownership: 'consignment' };
}

/** Absence of history is pre-feature owned stock, never today's supplier flag. */
export async function resolveHistoricalOwnership(
  db: PoolConnection, businessId: string, productId: string, effectiveAt: string,
): Promise<Ownership> {
  const [rows] = await db.execute<any[]>(
    `SELECT supplier_id, is_consignment FROM ims_consignment_ownership_history
      WHERE business_id = ? AND product_id = ? AND effective_at <= ?
      ORDER BY effective_at DESC, id DESC LIMIT 1`,
    [businessId, productId, effectiveAt],
  );
  if (!rows.length || Number(rows[0].is_consignment) !== 1) return { supplierId: null, ownership: 'owned' };
  return { supplierId: Number(rows[0].supplier_id), ownership: 'consignment' };
}

export async function appendOwnershipHistory(
  db: PoolConnection, businessId: string, productId: string, supplierId: number | null,
  isConsignment: boolean, actorId?: number | null,
) {
  await db.execute(
    `INSERT INTO ims_consignment_ownership_history
      (business_id,product_id,supplier_id,is_consignment,effective_at,actor_id,reason)
     VALUES (?,?,?,?,UTC_TIMESTAMP(6),?,?)`,
    [businessId, productId, supplierId, isConsignment ? 1 : 0, actorId ?? null, 'Supplier ownership setup changed'],
  );
}

/** No netting: a negative position or offsetting branch still prevents conversion. Includes inactive variants. */
export async function assertProductOwnershipChangeSafe(db: PoolConnection, businessId: string, productId: string) {
  const [rows] = await db.execute<any[]>(
    `SELECT 'stock or commitments' AS reason FROM ims_stock s
       JOIN ims_product_variants v ON v.variant_id = s.variant_id
      WHERE v.product_id = ? AND s.business_id = ?
        AND (s.qty_on_hand <> 0 OR s.qty_incoming <> 0 OR s.qty_committed <> 0)
     UNION ALL
     SELECT 'FIFO positions' FROM ims_fifo_cost_layers f
       JOIN ims_product_variants v ON v.variant_id = f.variant_id
      WHERE v.product_id = ? AND f.business_id = ? AND f.remaining_quantity <> 0
     UNION ALL
     SELECT 'open purchasing' FROM ims_purchase_order_items i
       JOIN ims_purchase_orders d ON d.id = i.po_id
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
      WHERE v.product_id = ? AND d.business_id = ? AND d.status NOT IN ('complete','cancelled')
     UNION ALL
     SELECT 'open supplier returns' FROM ims_supplier_credit_note_items i
       JOIN ims_supplier_credit_notes d ON d.id = i.scn_id
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
      WHERE v.product_id = ? AND d.business_id = ? AND d.status = 'draft'
     UNION ALL
     SELECT 'open sales orders' FROM ims_sales_order_items i
       JOIN ims_sales_orders d ON d.id = i.so_id
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
      WHERE v.product_id = ? AND d.business_id = ? AND d.status NOT IN ('fulfilled','cancelled')
     UNION ALL
     SELECT 'in-transit transfers' FROM ims_branch_transfer_items i
       JOIN ims_branch_transfers d ON d.id = i.transfer_id
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
      WHERE v.product_id = ? AND d.business_id = ? AND d.status NOT IN ('received','cancelled')
     UNION ALL
     SELECT 'unsettled tracked activity' FROM ims_consignment_events e
       JOIN ims_product_variants v ON v.variant_id = e.variant_id
       LEFT JOIN ims_consignment_statements d ON d.id = e.statement_id
       JOIN ims_consignment_tracking_intervals ti ON ti.id = e.tracking_interval_id
      WHERE v.product_id = ? AND e.business_id = ? AND e.tracking_interval_id IS NOT NULL
        AND e.source_type <> 'supplier_return'
        AND d.status IN ('Draft','Finalised')
     UNION ALL
     SELECT 'unsettled tracked activity' FROM ims_consignment_events e
       JOIN ims_product_variants v ON v.variant_id = e.variant_id
       JOIN ims_consignment_tracking_intervals ti ON ti.id = e.tracking_interval_id AND ti.disabled_at IS NULL
      WHERE v.product_id = ? AND e.business_id = ? AND e.statement_id IS NULL AND e.source_type <> 'supplier_return'
      HAVING ABS(COALESCE(SUM(e.quantity * e.unit_cost * (1 + e.tax_rate / 100)),0)) > 0.00005
         OR SUM(CASE WHEN e.exception IS NOT NULL THEN 1 ELSE 0 END) > 0
     UNION ALL
     SELECT 'open customer returns' FROM ims_credit_note_items i
       JOIN ims_credit_notes d ON d.id = i.cn_id
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
      WHERE v.product_id = ? AND d.business_id = ? AND d.status = 'draft'
     LIMIT 1`,
    Array.from({ length: 9 }, () => [productId, businessId]).flat(),
  );
  if (rows.length) throw new ConsignmentConflict(`Cannot change supplier ownership while this product has ${rows[0].reason}. Resolve every branch, inactive variant and outstanding obligation first; existing stock needs a separately reviewed conversion.`);
}

/** External catalogue writers may not silently reassign or construct consignment stock. */
export async function assertExternalCatalogueOwnershipSafe(db: PoolConnection, businessId: string, supplierId: number | null, productId?: string) {
  const [rows] = await db.execute<any[]>(
    `SELECT c.id FROM ims_contacts c WHERE c.business_id = ? AND c.is_consignment = 1
      AND (c.id = ? OR c.id IN (SELECT supplier_contact_id FROM ims_products WHERE product_id = ? AND business_id = ?))
      LIMIT 1 FOR UPDATE`, [businessId, supplierId, productId ?? '', businessId],
  );
  if (rows.length) throw new ConsignmentConflict('External catalogue imports cannot modify consignment supplier ownership. Review the product and supplier setup in IMS instead.');
}

export async function changeProductSupplier(
  db: PoolConnection, businessId: string, productId: string,
  data: { supplier_contact_id?: number | null; uses_builds?: number; is_stock_item?: number; product_type?: string },
) {
  await lockInventoryCostState(db, businessId);
  const [[product]] = await db.execute<any[]>('SELECT * FROM ims_products WHERE product_id = ? AND business_id = ? FOR UPDATE', [productId, businessId]);
  if (!product) throw new ConsignmentConflict('Product not found.');
  const supplierId = data.supplier_contact_id === undefined ? product.supplier_contact_id : data.supplier_contact_id;
  const [suppliers] = await db.execute<any[]>(
    'SELECT id, is_consignment FROM ims_contacts WHERE business_id = ? AND id IN (?,?) FOR UPDATE',
    [businessId, product.supplier_contact_id ?? 0, supplierId ?? 0],
  );
  const oldConsignment = suppliers.some(row => Number(row.id) === Number(product.supplier_contact_id) && Number(row.is_consignment) === 1);
  const newConsignment = suppliers.some(row => Number(row.id) === Number(supplierId) && Number(row.is_consignment) === 1);
  if (newConsignment) {
    assertConsignmentProductSupported({ ...product, ...data });
    const [[component]] = await db.execute<any[]>(
      `SELECT r.id FROM ims_product_build_recipe_components r JOIN ims_product_variants v ON v.variant_id = r.component_variant_id
        WHERE v.product_id = ? AND r.business_id = ? LIMIT 1`, [productId, businessId],
    );
    if (component) throw new ConsignmentConflict('Consignment build components are not supported. Remove the product from build recipes before changing ownership.');
  }
  if ((oldConsignment || newConsignment) && Number(product.supplier_contact_id ?? 0) !== Number(supplierId ?? 0)) {
    await assertProductOwnershipChangeSafe(db, businessId, productId);
    await appendOwnershipHistory(db, businessId, productId, supplierId == null ? null : Number(supplierId), newConsignment);
  }
}

export async function changeSupplierOwnership(
  db: PoolConnection, businessId: string, supplierId: number, enabled: boolean, actor?: OwnershipActor,
) {
  if (!actor?.isAdmin) throw new ConsignmentConflict('Only administrators can change consignment ownership.');
  await lockInventoryCostState(db, businessId);
  const [[supplier]] = await db.execute<any[]>('SELECT * FROM ims_contacts WHERE id = ? AND business_id = ? FOR UPDATE', [supplierId, businessId]);
  if (!supplier || !['supplier', 'both'].includes(supplier.type)) throw new ConsignmentConflict('Consignment requires a supplier contact.');
  if ((Number(supplier.is_consignment) === 1) === enabled) return;
  const [products] = await db.execute<any[]>('SELECT * FROM ims_products WHERE supplier_contact_id = ? AND business_id = ? FOR UPDATE', [supplierId, businessId]);
  for (const product of products) {
    if (enabled) assertConsignmentProductSupported(product);
    if (enabled) {
      const [[component]] = await db.execute<any[]>(
        `SELECT r.id FROM ims_product_build_recipe_components r JOIN ims_product_variants v ON v.variant_id = r.component_variant_id
          WHERE v.product_id = ? AND r.business_id = ? LIMIT 1`, [product.product_id, businessId],
      );
      if (component) throw new ConsignmentConflict('Consignment build components are not supported. Remove the product from build recipes before changing ownership.');
    }
    await assertProductOwnershipChangeSafe(db, businessId, String(product.product_id));
  }
  const [[openDocument]] = await db.execute<any[]>(
    `SELECT id FROM ims_purchase_orders WHERE supplier_id = ? AND business_id = ? AND status NOT IN ('complete','cancelled')
     UNION ALL SELECT id FROM ims_supplier_credit_notes WHERE supplier_id = ? AND business_id = ? AND status = 'draft' LIMIT 1`,
    [supplierId, businessId, supplierId, businessId],
  );
  if (openDocument) throw new ConsignmentConflict('Resolve open supplier purchasing and returns before changing consignment ownership.');
  await db.execute('UPDATE ims_contacts SET is_consignment = ? WHERE id = ? AND business_id = ?', [enabled ? 1 : 0, supplierId, businessId]);
  for (const product of products) await appendOwnershipHistory(db, businessId, String(product.product_id), supplierId, enabled, actor.actorId);
}

export async function assertConsignmentDocument(
  db: PoolConnection, businessId: string,
  document: { supplier_id?: number | null; currency_code?: string | null; exchange_rate?: number | null; consignment_supplier_id?: number | null },
  items: { variant_id?: string | null; unit_cost?: number; discount_pct?: number; tax_rate?: number }[],
  existing = false,
): Promise<number | null> {
  const [[supplier]] = document.supplier_id
    ? await db.execute<any[]>('SELECT is_consignment FROM ims_contacts WHERE id = ? AND business_id = ? FOR UPDATE', [document.supplier_id, businessId])
    : [[]];
  const owner = Number(supplier?.is_consignment) === 1 ? Number(document.supplier_id) : null;
  if (existing && (document.consignment_supplier_id ?? null) !== owner) throw new ConsignmentConflict('The document ownership snapshot cannot be changed. Create a new document for the new supplier.');
  if (owner && (String(document.currency_code ?? 'AUD').toUpperCase() !== 'AUD' || Number(document.exchange_rate ?? 1) !== 1)) {
    throw new ConsignmentConflict('Consignment supplier agreements support AUD only.');
  }
  for (const item of items) {
    if (!item.variant_id) {
      if (owner) throw new ConsignmentConflict('Consignment documents require matched stock products on every line.');
      continue;
    }
    const itemOwner = await resolveCurrentOwnership(db, businessId, item.variant_id);
    if (itemOwner.supplierId !== owner) throw new ConsignmentConflict('A consignment document cannot mix owned stock or products belonging to another supplier.');
    if (owner && (!Number.isFinite(Number(item.unit_cost)) || Number(item.unit_cost) < 0
      || !Number.isFinite(Number(item.tax_rate ?? 0)) || Number(item.tax_rate ?? 0) < 0
      || Number(item.discount_pct ?? 0) < 0 || Number(item.discount_pct ?? 0) > 100)) {
      throw new ConsignmentConflict('Consignment requires a known non-negative supplier cost, tax and valid discount.');
    }
  }
  return owner;
}

export async function snapshotMovementOwnership(db: PoolConnection, businessId: string, movementId: number, variantId: string, supplierId?: number | null) {
  const owner = supplierId === undefined ? (await resolveCurrentOwnership(db, businessId, variantId)).supplierId : supplierId;
  await db.execute(`UPDATE ims_stock_movements SET consignment_supplier_id = ? WHERE id = ${movementId ? '?' : 'LAST_INSERT_ID()'} AND business_id = ?`,
    movementId ? [owner, movementId, businessId] : [owner, businessId]);
}
