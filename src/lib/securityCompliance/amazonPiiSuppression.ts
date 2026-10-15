import { imsQuery } from '@/services/IMSMySQLService';
import { AmazonPiiConflictError } from './amazonPiiDisposal';

async function storageExists(): Promise<boolean> {
  const tables = await imsQuery<{ present: number }>(
    `SELECT 1 AS present FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_amazon_pii_disposals'`);
  return tables.length > 0;
}

export async function isAmazonOrderPiiCleared(businessId: string, salesOrderId: number): Promise<boolean> {
  if (!await storageExists()) return false;
  const receipts = await imsQuery<{ so_id: number }>(
    'SELECT so_id FROM ims_amazon_pii_disposals WHERE business_id = ? AND so_id = ? LIMIT 1',
    [businessId, salesOrderId]);
  return receipts.length > 0;
}

export async function assertShippingPiiNotCleared(businessId: string, shipmentIds: number[]): Promise<void> {
  if (!shipmentIds.length || !await storageExists()) return;
  const disposed = await imsQuery<{ so_id: number }>(
    `SELECT d.so_id FROM ims_amazon_pii_disposals d JOIN ims_shipping_shipments s
      ON s.so_id = d.so_id AND s.business_id = d.business_id
      WHERE s.business_id = ? AND s.id IN (${shipmentIds.map(() => '?').join(',')}) LIMIT 1`,
    [businessId, ...shipmentIds]);
  if (disposed.length) throw new AmazonPiiConflictError('Amazon buyer fields were cleared. Old labels and recipient copies cannot be regenerated.');
}
