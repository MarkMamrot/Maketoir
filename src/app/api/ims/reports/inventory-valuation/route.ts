import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const brand       = searchParams.get('brand')       ?? '';
  const supplierId  = searchParams.get('supplierId')  ?? '';
  const productType = searchParams.get('productType') ?? '';
  const productId   = searchParams.get('productId')   ?? '';

  const conds: string[] = ['v.is_active = 1', 'p.is_active = 1', 'p.business_id = ?'];
  const filterParams: any[] = [session.businessId];
  if (productId)   { conds.push('v.variant_id = ?');           filterParams.push(productId); }
  if (brand)       { conds.push('p.brand = ?');                filterParams.push(brand); }
  if (supplierId)  { conds.push('p.supplier_contact_id = ?');  filterParams.push(Number(supplierId)); }
  if (productType) { conds.push('p.product_type = ?');         filterParams.push(productType); }
  const where = 'WHERE ' + conds.join(' AND ');

  try {
    const costingRows = await imsQuery<{ active_method: 'average_cost' | 'fifo'; active_epoch_id: number | null }>(
      `SELECT active_method, active_epoch_id
         FROM ims_inventory_cost_state
        WHERE business_id = ?
        LIMIT 1`,
      [session.businessId],
    );
    const costingMethod = costingRows[0]?.active_method === 'fifo' ? 'fifo' : 'average_cost';
    const costEpochId = costingMethod === 'fifo' ? Number(costingRows[0]?.active_epoch_id) : null;
    if (costingMethod === 'fifo' && (!Number.isInteger(costEpochId) || Number(costEpochId) <= 0)) {
      throw new Error('FIFO costing is active but has no valid valuation epoch.');
    }
    const rows = await imsQuery<{
      variant_id: string;
      sku: string;
      name: string;
      brand: string;
      supplier_name: string;
      cost: number;
      soh: number;
      total_value: number;
      layer_quantity: number | null;
    }>(costingMethod === 'fifo' ? `
      SELECT
        v.variant_id,
        v.sku,
        p.name,
        p.brand,
        c.name as supplier_name,
        CASE WHEN COALESCE(f.layer_quantity, 0) > 0
          THEN f.layer_value / f.layer_quantity ELSE 0 END AS cost,
        COALESCE(s.soh, 0) AS soh,
        COALESCE(f.layer_value, 0) AS total_value,
        COALESCE(f.layer_quantity, 0) AS layer_quantity
      FROM ims_product_variants v
      JOIN ims_products p ON p.product_id = v.product_id
      LEFT JOIN ims_contacts c ON p.supplier_contact_id = c.id
      LEFT JOIN (
        SELECT variant_id, SUM(qty_on_hand) AS soh
          FROM ims_stock
         WHERE business_id = ?
         GROUP BY variant_id
      ) s ON s.variant_id = v.variant_id
      LEFT JOIN (
        SELECT variant_id, SUM(remaining_quantity) AS layer_quantity,
               SUM(remaining_quantity * unit_cost) AS layer_value
          FROM ims_fifo_cost_layers
         WHERE business_id = ? AND epoch_id = ?
         GROUP BY variant_id
      ) f ON f.variant_id = v.variant_id
      ${where}
      HAVING soh > 0 OR layer_quantity > 0
      ORDER BY p.brand, p.name, v.sku
    ` : `
      SELECT
        v.variant_id,
        v.sku,
        p.name,
        p.brand,
        c.name as supplier_name,
        COALESCE(NULLIF(v.avg_cost, 0), v.cost_aud, 0) AS cost,
        COALESCE(SUM(s.qty_on_hand), 0) AS soh,
        COALESCE(SUM(s.qty_on_hand), 0) * COALESCE(NULLIF(v.avg_cost, 0), v.cost_aud, 0) AS total_value,
        NULL AS layer_quantity
      FROM ims_product_variants v
      JOIN ims_products p ON p.product_id = v.product_id
      LEFT JOIN ims_contacts c ON p.supplier_contact_id = c.id
      LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.business_id = ?
      ${where}
      GROUP BY v.variant_id
      HAVING soh > 0
      ORDER BY p.brand, p.name, v.sku
    `, costingMethod === 'fifo'
      ? [session.businessId, session.businessId, costEpochId, ...filterParams]
      : [session.businessId, ...filterParams]);

    const data = rows.map(r => ({
      ...r,
      soh: Number(r.soh ?? 0),
      cost: Number(r.cost ?? 0),
      total_value: Number(r.total_value ?? 0),
      layer_quantity: r.layer_quantity == null ? null : Number(r.layer_quantity),
      reconciliation_delta: r.layer_quantity == null ? 0 : Number(r.soh ?? 0) - Number(r.layer_quantity),
    }));
    const mismatchedRows = data.filter(row => Math.abs(row.reconciliation_delta) > 0.0001);

    return NextResponse.json({
      success: true,
      data,
      costing_method: costingMethod,
      cost_epoch_id: costEpochId,
      reconciliation: {
        status: mismatchedRows.length === 0 ? 'balanced' : 'mismatch',
        mismatched_sku_count: mismatchedRows.length,
        stock_quantity: data.reduce((sum, row) => sum + row.soh, 0),
        valued_quantity: data.reduce((sum, row) => sum + (row.layer_quantity ?? row.soh), 0),
      },
    });
  } catch (e: any) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims_inventory_valuation',
      operation: 'load_report',
      title: 'Inventory valuation report failed',
      error: e,
      context: { brand, supplierId, productType, productId },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}


