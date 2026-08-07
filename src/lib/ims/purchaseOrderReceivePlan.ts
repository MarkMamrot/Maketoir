export type PurchaseOrderReceiveLine = {
  variantId: string;
  orderedQuantity: number;
  alreadyReceivedQuantity: number;
  enteredQuantity: number;
};

export type PurchaseOrderReceivePlan = {
  receivedItems: Array<{ variant_id: string; qty_received: number }>;
  shouldCallBatch: boolean;
  markPoReceived: boolean;
  createBackorderPo: boolean;
  shortfallLineCount: number;
};

export function planPurchaseOrderReceive(
  lines: PurchaseOrderReceiveLine[],
  targetStatus?: 'complete' | 'partially_received',
): PurchaseOrderReceivePlan {
  const normalized = lines.map(line => {
    const ordered = Math.max(0, Number(line.orderedQuantity));
    const alreadyReceived = Math.max(0, Math.min(ordered, Number(line.alreadyReceivedQuantity)));
    const entered = Math.max(alreadyReceived, Math.min(ordered, Number(line.enteredQuantity)));
    return { ...line, ordered, alreadyReceived, entered };
  });
  const receivedItems = normalized
    .map(line => ({ variant_id: line.variantId, qty_received: line.entered - line.alreadyReceived }))
    .filter(line => line.variant_id && line.qty_received > 0);
  const markPoReceived = targetStatus === 'complete';
  const shortfallLineCount = normalized.filter(line => line.entered < line.ordered).length;

  return {
    receivedItems,
    shouldCallBatch: receivedItems.length > 0 || markPoReceived,
    markPoReceived,
    createBackorderPo: markPoReceived && shortfallLineCount > 0,
    shortfallLineCount,
  };
}