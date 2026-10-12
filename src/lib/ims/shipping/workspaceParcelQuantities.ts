type WorkspaceOrderItem = {
  id: number;
  sku?: string | null;
  product_name?: string | null;
  notes?: string | null;
  qty_ordered: number;
  qty_fulfilled: number;
};

export function workspaceParcelItemLabel(item: Pick<WorkspaceOrderItem, "id" | "sku" | "product_name" | "notes">): string {
  const sku = String(item.sku ?? "").trim();
  const originalName = String(item.notes ?? "").trim();
  if (sku.toUpperCase() === "SHOPIFY-MISC" && originalName)
    return `${originalName} (${sku})`;
  return sku || item.product_name || `Item ${item.id}`;
}

export function workspaceParcelQuantityIssue(
  items: readonly WorkspaceOrderItem[],
  parcels: readonly {
    allocations: readonly { soItemId: number; quantity: number }[];
  }[],
): string {
  for (const item of items) {
    const remaining = Math.max(
      0,
      Number(item.qty_ordered) - Number(item.qty_fulfilled),
    );
    const allocated = parcels.reduce(
      (sum, parcel) =>
        sum + parcel.allocations.reduce(
          (parcelSum, allocation) =>
            parcelSum + (allocation.soItemId === Number(item.id) ? allocation.quantity : 0),
          0,
        ),
      0,
    );
    if (Math.abs(remaining - allocated) < 0.0001) continue;
    const format = (value: number) => String(Number(value.toFixed(4)));
    const action = allocated > remaining ? "Reduce" : "Increase";
    const remainingUnits = remaining === 1 ? "unit remains" : "units remain";
    return `${workspaceParcelItemLabel(item)}: ${format(allocated)} units entered across all parcels, but ${format(remaining)} ${remainingUnits} to ship. ${action} the total item quantity to ${format(remaining)}. These fields are item counts, not parcel measurements.`;
  }
  return "";
}
