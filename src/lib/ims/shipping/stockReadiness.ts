export type ShippingStockDemandRow = {
  shipmentId: number;
  soId: number;
  soNumber: string;
  locationId: number;
  locationName: string;
  variantId: string;
  sku: string;
  productName: string;
  requestedQuantity: number;
  quantityOnHand: number;
  quantityCommitted: number;
  purchaseOrderIncomingQuantity: number;
};

export type ShippingIncomingTransferRow = {
  transferId: number;
  transferNumber: string;
  status: "sent" | "partial";
  locationId: number;
  variantId: string;
  quantity: number;
};

export type ShippingStockReadinessLine = {
  locationId: number;
  locationName: string;
  variantId: string;
  sku: string;
  productName: string;
  shipmentIds: number[];
  soNumbers: string[];
  requestedQuantity: number;
  quantityOnHand: number;
  quantityCommitted: number;
  shortfallQuantity: number;
  purchaseOrderIncomingQuantity: number;
  incomingTransferQuantity: number;
  coveredByIncomingTransfer: number;
  uncoveredQuantity: number;
  transfers: Array<{
    transferId: number;
    transferNumber: string;
    status: "sent" | "partial";
    quantity: number;
  }>;
};

export type ShippingStockReadiness = {
  ready: boolean;
  lines: ShippingStockReadinessLine[];
};

export function buildShippingStockReadiness(
  demandRows: readonly ShippingStockDemandRow[],
  incomingRows: readonly ShippingIncomingTransferRow[],
): ShippingStockReadiness {
  const incomingByStockKey = new Map<string, ShippingIncomingTransferRow[]>();
  for (const transfer of incomingRows) {
    if (!(transfer.quantity > 0)) continue;
    const key = `${transfer.locationId}:${transfer.variantId}`;
    incomingByStockKey.set(key, [...(incomingByStockKey.get(key) ?? []), transfer]);
  }

  const grouped = new Map<string, ShippingStockReadinessLine>();
  for (const demand of demandRows) {
    const key = `${demand.locationId}:${demand.variantId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.requestedQuantity += demand.requestedQuantity;
      if (!existing.shipmentIds.includes(demand.shipmentId)) existing.shipmentIds.push(demand.shipmentId);
      if (!existing.soNumbers.includes(demand.soNumber)) existing.soNumbers.push(demand.soNumber);
      continue;
    }
    grouped.set(key, {
      locationId: demand.locationId,
      locationName: demand.locationName,
      variantId: demand.variantId,
      sku: demand.sku,
      productName: demand.productName,
      shipmentIds: [demand.shipmentId],
      soNumbers: [demand.soNumber],
      requestedQuantity: demand.requestedQuantity,
      quantityOnHand: demand.quantityOnHand,
      quantityCommitted: demand.quantityCommitted,
      shortfallQuantity: 0,
      purchaseOrderIncomingQuantity: demand.purchaseOrderIncomingQuantity,
      incomingTransferQuantity: 0,
      coveredByIncomingTransfer: 0,
      uncoveredQuantity: 0,
      transfers: [],
    });
  }

  const lines = [...grouped.entries()].map(([key, line]) => {
    const transfers = (incomingByStockKey.get(key) ?? []).map((transfer) => ({
      transferId: transfer.transferId,
      transferNumber: transfer.transferNumber,
      status: transfer.status,
      quantity: transfer.quantity,
    }));
    const incomingTransferQuantity = transfers.reduce((sum, transfer) => sum + transfer.quantity, 0);
    const shortfallQuantity = Math.max(0, line.requestedQuantity - line.quantityOnHand);
    const coveredByIncomingTransfer = Math.min(shortfallQuantity, incomingTransferQuantity);
    return {
      ...line,
      shortfallQuantity,
      incomingTransferQuantity,
      coveredByIncomingTransfer,
      uncoveredQuantity: Math.max(0, shortfallQuantity - incomingTransferQuantity),
      transfers,
    };
  }).filter((line) => line.shortfallQuantity > 0);

  return { ready: lines.length === 0, lines };
}