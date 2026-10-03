import { imsQuery } from '@/services/IMSMySQLService';
import { loadStockAvailabilityRows } from '../stockAvailabilityQuery';
import { buildFifoAllocationSuggestions } from './domain';

type SuggestionSupplyRow = {
  po_id: number | string;
  po_item_id: number | string;
  po_number: string;
  supplier_name: string | null;
  variant_id: string;
  location_id: number | string;
  qty_ordered: number | string;
  qty_received: number | string;
  active_allocated_quantity: number | string;
  expected_date: string | null;
  status: string;
};

export type StockAllocationSuggestionPreview = {
  soId: number;
  soItemId: number;
  soNumber: string;
  customerName: string;
  requiredDate: string | null;
  priorityPosition: number;
  sku: string | null;
  productName: string;
  locationName: string;
  poId: number;
  poItemId: number;
  poNumber: string;
  supplierName: string | null;
  expectedDate: string | null;
  quantity: number;
};

export async function loadStockAllocationSuggestions(
  businessId: string,
): Promise<StockAllocationSuggestionPreview[]> {
  const [demands, supplies] = await Promise.all([
    loadStockAvailabilityRows(businessId),
    imsQuery<SuggestionSupplyRow>(
      `SELECT po.id AS po_id, poi.id AS po_item_id, po.po_number,
              COALESCE(s.name, po.supplier_name_raw, 'Unknown supplier') AS supplier_name,
              poi.variant_id, po.location_id, poi.qty_ordered, poi.qty_received,
              COALESCE(SUM(a.qty_allocated - a.qty_received_assigned), 0) AS active_allocated_quantity,
              po.expected_date, po.status
         FROM ims_purchase_order_items poi
         JOIN ims_purchase_orders po ON po.id = poi.po_id AND po.business_id = ?
         LEFT JOIN ims_contacts s ON s.id = po.supplier_id
         LEFT JOIN ims_stock_allocations a ON a.po_item_id = poi.id
          AND a.business_id COLLATE utf8mb4_general_ci = poi.business_id COLLATE utf8mb4_general_ci
          AND a.state = 'active'
        WHERE poi.business_id = ? AND po.status IN ('confirmed','partially_received')
          AND poi.qty_ordered > poi.qty_received
        GROUP BY po.id, poi.id, po.po_number, s.name, po.supplier_name_raw, poi.variant_id,
                 po.location_id, poi.qty_ordered, poi.qty_received, po.expected_date, po.status
        ORDER BY po.expected_date IS NULL, po.expected_date, po.id, poi.id`,
      [businessId, businessId],
    ),
  ]);

  const suggestions = buildFifoAllocationSuggestions(demands.map(row => ({
    soId: Number(row.so_id),
    soItemId: Number(row.so_item_id),
    variantId: String(row.variant_id),
    locationId: Number(row.location_id),
    orderedQuantity: Number(row.qty_ordered),
    fulfilledQuantity: Number(row.qty_fulfilled ?? 0),
    activeAllocatedQuantity: Number(row.qty_allocated ?? 0) - Number(row.allocation_qty_fulfilled ?? 0),
    requiredDate: row.expected_date,
    confirmedAt: new Date(row.created_at).toISOString(),
  })), supplies.map(row => ({
    poId: Number(row.po_id),
    poItemId: Number(row.po_item_id),
    variantId: String(row.variant_id),
    locationId: Number(row.location_id),
    orderedQuantity: Number(row.qty_ordered),
    receivedQuantity: Number(row.qty_received ?? 0),
    activeAllocatedQuantity: Number(row.active_allocated_quantity ?? 0),
    expectedDate: row.expected_date,
    status: row.status,
  })));

  const priorityGroups = new Map<string, typeof demands>();
  for (const demand of demands) {
    const key = `${demand.location_id}\u0000${demand.variant_id}`;
    priorityGroups.set(key, [...(priorityGroups.get(key) ?? []), demand]);
  }
  const priorityByItemId = new Map<number, number>();
  for (const group of priorityGroups.values()) {
    group
      .sort((left, right) => String(left.expected_date ?? '9999-12-31').localeCompare(String(right.expected_date ?? '9999-12-31'))
        || new Date(left.created_at).toISOString().localeCompare(new Date(right.created_at).toISOString())
        || Number(left.so_id) - Number(right.so_id)
        || Number(left.so_item_id) - Number(right.so_item_id))
      .forEach((row, index) => priorityByItemId.set(Number(row.so_item_id), index + 1));
  }
  const demandByItemId = new Map(demands.map(row => [Number(row.so_item_id), row]));
  const supplyByItemId = new Map(supplies.map(row => [Number(row.po_item_id), row]));
  return suggestions.map(suggestion => {
    const demand = demandByItemId.get(suggestion.soItemId)!;
    const supply = supplyByItemId.get(suggestion.poItemId)!;
    return {
      soId: suggestion.soId,
      soItemId: suggestion.soItemId,
      soNumber: demand.so_number,
      customerName: demand.customer_name,
      requiredDate: demand.expected_date,
      priorityPosition: priorityByItemId.get(suggestion.soItemId)!,
      sku: demand.sku,
      productName: demand.product_name,
      locationName: demand.location_name,
      poId: suggestion.poId,
      poItemId: suggestion.poItemId,
      poNumber: supply.po_number,
      supplierName: supply.supplier_name,
      expectedDate: suggestion.expectedDate,
      quantity: suggestion.quantity,
    };
  });
}