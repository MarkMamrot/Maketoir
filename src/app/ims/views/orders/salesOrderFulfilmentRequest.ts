export type SalesOrderFulfilmentMode = 'partial' | 'backorder';

export type SalesOrderFulfilmentItemInput = { itemId: number; quantity: number };

export type SalesOrderFulfilmentRequest = { endpoint: string; body: Record<string, unknown> };

const QUANTITY_SCALE = 10_000;

export function summarizeFulfilmentAllocations(allocations: any[]): Map<number, { protected: number; ready: number; incoming: number }> {
  const result = new Map<number, { protected: number; ready: number; incoming: number }>();
  for (const allocation of allocations) {
    if (allocation.state !== 'active') continue;
    const itemId = Number(allocation.so_item_id);
    const remaining = Math.max(0, Number(allocation.qty_allocated ?? 0) - Number(allocation.qty_fulfilled ?? 0));
    const ready = Math.min(remaining, Math.max(0, Number(allocation.qty_received_assigned ?? 0) - Number(allocation.qty_fulfilled ?? 0)));
    const current = result.get(itemId) ?? { protected: 0, ready: 0, incoming: 0 };
    current.protected += remaining;
    current.ready += ready;
    current.incoming += Math.max(0, remaining - ready);
    result.set(itemId, current);
  }
  return result;
}

export async function buildSalesOrderFulfilmentOperationKey(
  mode: SalesOrderFulfilmentMode,
  soId: number,
  updatedAt: string | null | undefined,
  items: SalesOrderFulfilmentItemInput[],
): Promise<string> {
  const canonicalRequest = {
    soId,
    revision: String(updatedAt ?? '').trim() || 'unversioned',
    mode,
    negativeStockPolicy: 'confirm_on_shortfall',
    quantities: items
      .map(item => ({ itemId: Number(item.itemId), quantity: Math.round(Number(item.quantity) * QUANTITY_SCALE) }))
      .sort((left, right) => left.itemId - right.itemId),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalRequest));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const requestHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `sales_order:${soId}:${mode}:revision_request:${requestHash}`;
}

export function buildSalesOrderFulfilmentRequest(mode: SalesOrderFulfilmentMode, soId: number, items: SalesOrderFulfilmentItemInput[]): SalesOrderFulfilmentRequest {
  const body = items.map(({ itemId, quantity }) => ({ itemId, quantity }));
  if (mode === 'backorder') {
    return { endpoint: `/api/ims/sales-orders/${soId}/backorder`, body: { fulfilQuantities: body } };
  }
  return { endpoint: `/api/ims/sales-orders/${soId}/fulfil`, body: { shipmentQuantities: body } };
}
