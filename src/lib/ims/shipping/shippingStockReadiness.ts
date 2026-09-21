import { imsQuery } from "@/services/IMSMySQLService";
import {
  buildShippingStockReadiness,
  type ShippingIncomingTransferRow,
  type ShippingStockDemandRow,
  type ShippingStockReadiness,
} from "./stockReadiness";

export async function getShippingStockReadiness(input: {
  businessId: string;
  shipmentIds: number[];
}): Promise<ShippingStockReadiness> {
  const shipmentIds = [...new Set(input.shipmentIds.map(Number))];
  if (!shipmentIds.length || shipmentIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("Choose at least one prepared shipment.");
  }

  const placeholders = shipmentIds.map(() => "?").join(",");
  const demandRows = await imsQuery<any>(
    `SELECT shipment.id AS shipment_id, sales_order.id AS so_id, sales_order.so_number,
            shipment.dispatch_location_id AS location_id, location.name AS location_name,
            variant.variant_id, variant.sku, product.name AS product_name,
            parcel_item.quantity AS requested_quantity,
            COALESCE(stock.qty_on_hand, 0) AS quantity_on_hand,
            COALESCE(stock.qty_committed, 0) AS quantity_committed,
            COALESCE(stock.qty_incoming, 0) AS purchase_order_incoming_quantity
       FROM ims_shipping_shipments shipment
       JOIN ims_sales_orders sales_order
         ON sales_order.id = shipment.so_id AND sales_order.business_id = shipment.business_id
       JOIN ims_shipping_parcels parcel
         ON parcel.shipment_id = shipment.id AND parcel.business_id = shipment.business_id
       JOIN ims_shipping_parcel_items parcel_item
         ON parcel_item.parcel_id = parcel.id AND parcel_item.business_id = parcel.business_id
       JOIN ims_sales_order_items sales_item
         ON sales_item.id = parcel_item.so_item_id AND sales_item.business_id = shipment.business_id
       JOIN ims_product_variants variant
         ON variant.variant_id = sales_item.variant_id AND variant.business_id = shipment.business_id
       JOIN ims_products product
         ON product.product_id = variant.product_id AND product.business_id = shipment.business_id
       JOIN ims_locations location
         ON location.id = shipment.dispatch_location_id AND location.business_id = shipment.business_id
       LEFT JOIN ims_stock stock
         ON stock.business_id = shipment.business_id
        AND stock.location_id = shipment.dispatch_location_id
        AND stock.variant_id = variant.variant_id
      WHERE shipment.business_id = ?
        AND shipment.id IN (${placeholders})
        AND COALESCE(product.is_stock_item, 1) = 1
        AND shipment.status NOT IN ('voided', 'complete')`,
    [input.businessId, ...shipmentIds],
  );

  const foundShipmentIds = new Set(demandRows.map((row) => Number(row.shipment_id)));
  const missingShipmentIds = shipmentIds.filter((id) => !foundShipmentIds.has(id));
  if (missingShipmentIds.length) {
    const existing = await imsQuery<{ id: number }>(
      `SELECT id FROM ims_shipping_shipments
        WHERE business_id = ? AND id IN (${placeholders})`,
      [input.businessId, ...shipmentIds],
    );
    const existingIds = new Set(existing.map((row) => Number(row.id)));
    const unknownIds = shipmentIds.filter((id) => !existingIds.has(id));
    if (unknownIds.length) throw new Error("One or more prepared shipments were not found.");
  }

  const stockKeys = [...new Set(demandRows.map((row) => `${Number(row.location_id)}:${String(row.variant_id)}`))];
  let incomingRows: ShippingIncomingTransferRow[] = [];
  if (stockKeys.length) {
    const keyConditions = stockKeys.map(() => "(transfer.to_location_id = ? AND item.variant_id = ?)").join(" OR ");
    const keyParams = stockKeys.flatMap((key) => {
      const separator = key.indexOf(":");
      return [Number(key.slice(0, separator)), key.slice(separator + 1)];
    });
    const rows = await imsQuery<any>(
      `SELECT transfer.id AS transfer_id, transfer.transfer_number, transfer.status,
              transfer.to_location_id AS location_id, item.variant_id,
              GREATEST(item.qty_sent - COALESCE(item.qty_received, 0), 0) AS quantity
         FROM ims_branch_transfers transfer
         JOIN ims_branch_transfer_items item ON item.transfer_id = transfer.id
        WHERE transfer.business_id = ?
          AND transfer.status IN ('sent', 'partial')
          AND (${keyConditions})`,
      [input.businessId, ...keyParams],
    );
    incomingRows = rows.map((row) => ({
      transferId: Number(row.transfer_id),
      transferNumber: String(row.transfer_number),
      status: row.status,
      locationId: Number(row.location_id),
      variantId: String(row.variant_id),
      quantity: Number(row.quantity),
    }));
  }

  const demands: ShippingStockDemandRow[] = demandRows.map((row) => ({
    shipmentId: Number(row.shipment_id),
    soId: Number(row.so_id),
    soNumber: String(row.so_number),
    locationId: Number(row.location_id),
    locationName: String(row.location_name),
    variantId: String(row.variant_id),
    sku: String(row.sku ?? "").trim(),
    productName: String(row.product_name),
    requestedQuantity: Number(row.requested_quantity),
    quantityOnHand: Number(row.quantity_on_hand),
    quantityCommitted: Number(row.quantity_committed),
    purchaseOrderIncomingQuantity: Number(row.purchase_order_incoming_quantity),
  }));
  return buildShippingStockReadiness(demands, incomingRows);
}