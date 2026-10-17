import { getIMSPool } from '@/services/IMSMySQLService';
import type { ShopifyShipment } from './shopifyFulfilment';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

type ShopifyShipmentInput = {
  businessId: string;
  channelInstanceId?: string;
  soId: number;
  shipment: ShopifyShipment;
};

export async function persistShopifyShipment(input: ShopifyShipmentInput): Promise<void> {
  const conn = await getIMSPool().getConnection();
  try {
    await conn.beginTransaction();
    await persistShopifyShipmentInTransaction(conn, input);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function persistShopifyShipmentInTransaction(
  conn: PoolConnection,
  input: ShopifyShipmentInput,
): Promise<void> {
    const [[order]] = await conn.execute<(RowDataPacket & { channel_instance_id: string | null })[]>(
      `SELECT channel_instance_id FROM ims_sales_orders
        WHERE business_id = ? AND id = ? FOR UPDATE`,
      [input.businessId, input.soId],
    );
    if (!order) throw new Error('Sales order was not found for Shopify shipment persistence.');
    const ownedChannelInstanceId = String(order.channel_instance_id ?? '').trim();
    if (input.channelInstanceId && ownedChannelInstanceId && input.channelInstanceId !== ownedChannelInstanceId) {
      throw new Error('Shopify shipment channel instance does not own this sales order.');
    }
    const channelInstanceId = input.channelInstanceId || ownedChannelInstanceId || 'legacy';
    await conn.execute(
      `INSERT INTO ims_so_shipments
        (business_id, channel_instance_id, so_id, shopify_fulfilment_id, status, fulfilled_at, shopify_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE so_id = VALUES(so_id), status = VALUES(status),
         fulfilled_at = VALUES(fulfilled_at), shopify_updated_at = VALUES(shopify_updated_at)`,
      [input.businessId, channelInstanceId, input.soId, input.shipment.shopifyFulfilmentId, input.shipment.status,
        input.shipment.createdAt, input.shipment.updatedAt],
    );
    const [[row]] = await conn.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM ims_so_shipments
        WHERE business_id = ? AND channel_instance_id = ? AND shopify_fulfilment_id = ? FOR UPDATE`,
      [input.businessId, channelInstanceId, input.shipment.shopifyFulfilmentId],
    );
    if (!row) throw new Error('Shopify shipment could not be reloaded after persistence.');
    const shipmentId = Number(row.id);
    await conn.execute('DELETE FROM ims_so_shipment_items WHERE business_id = ? AND shipment_id = ?', [input.businessId, shipmentId]);
    await conn.execute('DELETE FROM ims_so_shipment_tracking WHERE business_id = ? AND shipment_id = ?', [input.businessId, shipmentId]);
    for (const item of input.shipment.items) {
      await conn.execute(
        `INSERT INTO ims_so_shipment_items
          (business_id, shipment_id, shopify_line_item_id, quantity) VALUES (?, ?, ?, ?)`,
        [input.businessId, shipmentId, item.shopifyLineItemId, item.quantity],
      );
    }
    for (const tracking of input.shipment.tracking) {
      await conn.execute(
        `INSERT INTO ims_so_shipment_tracking
          (business_id, shipment_id, company, tracking_number, tracking_url) VALUES (?, ?, ?, ?, ?)`,
        [input.businessId, shipmentId, tracking.company, tracking.number, tracking.url],
      );
    }
}