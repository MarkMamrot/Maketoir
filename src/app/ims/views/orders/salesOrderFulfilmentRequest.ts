export type SalesOrderFulfilmentMode = 'partial' | 'backorder';

export type SalesOrderFulfilmentItemInput = { itemId: number; quantity: number };

export type SalesOrderFulfilmentRequest = { endpoint: string; body: Record<string, unknown> };

export function buildSalesOrderFulfilmentRequest(mode: SalesOrderFulfilmentMode, soId: number, items: SalesOrderFulfilmentItemInput[]): SalesOrderFulfilmentRequest {
  const body = items.map(({ itemId, quantity }) => ({ itemId, quantity }));
  if (mode === 'backorder') {
    return { endpoint: `/api/ims/sales-orders/${soId}/backorder`, body: { fulfilQuantities: body } };
  }
  return { endpoint: `/api/ims/sales-orders/${soId}/fulfil`, body: { shipmentQuantities: body } };
}
