import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export interface ReplenishItem {
  variant_id: string;
  sku: string | null;
  brand_name: string | null;
  product_name: string;
  variant_label: string | null;
  need: number;
  branch_soh: number;
  warehouse_soh: number;
  allocated: number;
  unit_cost: number;
}

export interface ReplenishBranch {
  location_id: number;
  location_name: string;
  items: ReplenishItem[];
}

export async function POST(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json() as {
    warehouse_id: number;
    branch_ids: number[];
    strategy: 'even' | 'priority';
    priority_order: number[];
  };

  const { warehouse_id, branch_ids, strategy, priority_order } = body;

  if (!warehouse_id || !Array.isArray(branch_ids) || branch_ids.length === 0) {
    return NextResponse.json({ error: 'warehouse_id and branch_ids are required.' }, { status: 400 });
  }

  // Ensure warehouse is not in branch list
  const filteredBranchIds = branch_ids.filter(id => id !== warehouse_id);
  if (filteredBranchIds.length === 0) {
    return NextResponse.json({ error: 'No valid branch IDs (warehouse excluded).' }, { status: 400 });
  }

  // ── 1. Fetch all stock for branches where SOH < min_qty and min_qty > 0 ──
  const branchPlaceholders = filteredBranchIds.map(() => '?').join(',');
  const branchNeedsRaw = await imsQuery<{
    variant_id: string;
    location_id: number;
    location_name: string;
    qty_on_hand: number;
    min_qty: number;
    reorder_qty: number;
    avg_cost: number | null;
    sku: string | null;
    brand_name: string | null;
    product_name: string;
    variant_label: string | null;
  }>(
    `SELECT
       s.variant_id,
       s.location_id,
       l.name AS location_name,
       s.qty_on_hand,
       s.min_qty,
       s.reorder_qty,
       s.avg_cost,
       v.sku,
       br.name AS brand_name,
       p.name AS product_name,
       NULLIF(TRIM(CONCAT_WS(' / ',
         NULLIF(TRIM(COALESCE(v.option1_value,'')), ''),
         NULLIF(TRIM(COALESCE(v.option2_value,'')), ''),
         NULLIF(TRIM(COALESCE(v.option3_value,'')), '')
       )), '') AS variant_label
     FROM ims_stock s
     JOIN ims_locations l ON l.id = s.location_id
     JOIN ims_product_variants v ON v.variant_id = s.variant_id AND v.is_active = 1
     JOIN ims_products p ON p.product_id = v.product_id AND p.is_active = 1
     LEFT JOIN ims_brands br ON br.id = p.brand_id
     WHERE s.location_id IN (${branchPlaceholders})
       AND s.qty_on_hand < s.min_qty
       AND s.min_qty > 0`,
    filteredBranchIds
  );

  if (branchNeedsRaw.length === 0) {
    return NextResponse.json({ branches: [], message: 'All branches are at or above minimum stock.' });
  }

  // ── 2. Get unique variant IDs that need replenishment ──
  const variantIds = [...new Set(branchNeedsRaw.map(r => r.variant_id))];

  // ── 3. Fetch warehouse stock for those variants ──
  const varPlaceholders = variantIds.map(() => '?').join(',');
  const warehouseStockRaw = await imsQuery<{
    variant_id: string;
    qty_on_hand: number;
    avg_cost: number | null;
  }>(
    `SELECT s.variant_id, s.qty_on_hand, s.avg_cost
     FROM ims_stock s
     WHERE s.location_id = ? AND s.variant_id IN (${varPlaceholders})`,
    [warehouse_id, ...variantIds]
  );

  const warehouseMap = new Map(warehouseStockRaw.map(r => [r.variant_id, r]));

  // ── 4. Build needs map: variant_id → { branch_id → need } ──
  type BranchNeed = { location_id: number; location_name: string; need: number; branch_soh: number; unit_cost: number; sku: string | null; brand_name: string | null; product_name: string; variant_label: string | null };
  const needsByVariant = new Map<string, BranchNeed[]>();

  for (const row of branchNeedsRaw) {
    const need = row.reorder_qty > 0
      ? row.reorder_qty
      : Math.max(0, row.min_qty - row.qty_on_hand);
    if (need <= 0) continue;

    const unitCost = row.avg_cost ?? 0;
    if (!needsByVariant.has(row.variant_id)) needsByVariant.set(row.variant_id, []);
    needsByVariant.get(row.variant_id)!.push({
      location_id: row.location_id,
      location_name: row.location_name,
      need,
      branch_soh: row.qty_on_hand,
      unit_cost: unitCost,
      sku: row.sku,
      brand_name: row.brand_name,
      product_name: row.product_name,
      variant_label: row.variant_label,
    });
  }

  // ── 5. Allocate warehouse stock per variant ──
  // allocation[branch_id][variant_id] = qty
  const allocation = new Map<number, Map<string, ReplenishItem>>();
  for (const branchId of filteredBranchIds) {
    allocation.set(branchId, new Map());
  }

  // Priority order: user-supplied order, fall back to branch_ids order
  const effectivePriorityOrder = priority_order.length > 0
    ? priority_order.filter(id => filteredBranchIds.includes(id))
    : filteredBranchIds;
  // Append any branch_ids not in priority_order
  for (const id of filteredBranchIds) {
    if (!effectivePriorityOrder.includes(id)) effectivePriorityOrder.push(id);
  }

  for (const [variant_id, branchNeeds] of needsByVariant) {
    const wh = warehouseMap.get(variant_id);
    const warehouse_soh = wh?.qty_on_hand ?? 0;
    const totalNeed = branchNeeds.reduce((s, b) => s + b.need, 0);

    let allocations: Map<number, number>;

    if (warehouse_soh >= totalNeed) {
      // Enough for everyone — give each branch exactly what they need
      allocations = new Map(branchNeeds.map(b => [b.location_id, b.need]));
    } else if (warehouse_soh <= 0) {
      // Nothing available — allocate 0 to all
      allocations = new Map(branchNeeds.map(b => [b.location_id, 0]));
    } else if (strategy === 'priority') {
      // Fill in priority order until stock runs out
      allocations = new Map(branchNeeds.map(b => [b.location_id, 0]));
      let remaining = warehouse_soh;
      for (const branchId of effectivePriorityOrder) {
        const bn = branchNeeds.find(b => b.location_id === branchId);
        if (!bn || remaining <= 0) continue;
        const give = Math.min(bn.need, remaining);
        allocations.set(branchId, give);
        remaining -= give;
      }
    } else {
      // Even: distribute proportionally to need, rounded down, remainder to first branches
      allocations = new Map(branchNeeds.map(b => [b.location_id, 0]));
      let remaining = warehouse_soh;
      const sortedNeeds = [...branchNeeds].sort((a, b) => b.need - a.need);
      // Proportional floor allocation
      for (const bn of sortedNeeds) {
        const proportional = Math.floor(warehouse_soh * bn.need / totalNeed);
        const give = Math.min(proportional, bn.need, remaining);
        allocations.set(bn.location_id, give);
        remaining -= give;
      }
      // Distribute leftover to branches that still have unmet need, in need-size order
      for (const bn of sortedNeeds) {
        if (remaining <= 0) break;
        const current = allocations.get(bn.location_id)!;
        const stillNeeds = bn.need - current;
        if (stillNeeds > 0) {
          const extra = Math.min(stillNeeds, remaining);
          allocations.set(bn.location_id, current + extra);
          remaining -= extra;
        }
      }
    }

    // Write allocations to per-branch map
    const firstBranchNeed = branchNeeds[0]; // for shared info
    for (const bn of branchNeeds) {
      const allocated = allocations.get(bn.location_id) ?? 0;
      const branchMap = allocation.get(bn.location_id)!;
      branchMap.set(variant_id, {
        variant_id,
        sku: bn.sku,
        brand_name: bn.brand_name,
        product_name: bn.product_name,
        variant_label: bn.variant_label,
        need: bn.need,
        branch_soh: bn.branch_soh,
        warehouse_soh,
        allocated,
        unit_cost: bn.unit_cost,
      });
    }
  }

  // ── 6. Build result branches (only include branches with at least 1 need) ──
  const locationNames = new Map(branchNeedsRaw.map(r => [r.location_id, r.location_name]));

  const branches: ReplenishBranch[] = filteredBranchIds
    .map(branchId => {
      const items = [...(allocation.get(branchId)?.values() ?? [])];
      // Sort: by brand then product name
      items.sort((a, b) => {
        const aBrand = a.brand_name ?? '';
        const bBrand = b.brand_name ?? '';
        if (aBrand !== bBrand) return aBrand.localeCompare(bBrand);
        return a.product_name.localeCompare(b.product_name);
      });
      return {
        location_id: branchId,
        location_name: locationNames.get(branchId) ?? String(branchId),
        items,
      };
    })
    .filter(b => b.items.length > 0);

  return NextResponse.json({ branches });
}
