import { query } from '@/services/MySQLService';

export interface OnlineBatchIdentity {
  day: string;
  channel_instance_id: string;
}

export function onlineBatchKey(batch: OnlineBatchIdentity): string {
  return `online batch ${batch.channel_instance_id} ${batch.day}`;
}

export async function getCompletedOnlineBatchKeys(
  businessId: string,
  batches: OnlineBatchIdentity[],
): Promise<Set<string>> {
  if (batches.length === 0) return new Set();
  const keys = batches.map(onlineBatchKey);
  const exactRows = await query<{ batch_key: string }>(
    `SELECT sync_log.detail AS batch_key
       FROM xero_sync_log sync_log
      WHERE BINARY sync_log.business_id = BINARY ?
        AND sync_log.sync_type = 'online_batch'
        AND sync_log.status = 'success'
        AND sync_log.detail IN (${keys.map(() => '?').join(',')})`,
    [businessId, ...keys],
  );
  const migratedRows = await query<{ batch_key: string }>(
    `SELECT CONCAT('online batch ', batch.channel_instance_id, ' ', DATE_FORMAT(batch.batch_date, '%Y-%m-%d')) AS batch_key
       FROM xero_online_batches batch
       JOIN xero_sync_log legacy_log
         ON BINARY legacy_log.business_id = BINARY batch.business_id
        AND legacy_log.sync_type = 'online_batch'
        AND legacy_log.status = 'success'
        AND BINARY legacy_log.xero_id = BINARY batch.xero_invoice_id
        AND BINARY legacy_log.detail = BINARY CONCAT('online batch ', DATE_FORMAT(batch.batch_date, '%Y-%m-%d'))
      WHERE BINARY batch.business_id = BINARY ?
        AND batch.channel_instance_id IS NOT NULL
        AND batch.xero_invoice_id IS NOT NULL
        AND CONCAT('online batch ', batch.channel_instance_id, ' ', DATE_FORMAT(batch.batch_date, '%Y-%m-%d'))
            IN (${keys.map(() => '?').join(',')})`,
    [businessId, ...keys],
  ).catch(() => [] as { batch_key: string }[]);
  return new Set([...exactRows, ...migratedRows].map(row => String(row.batch_key)));
}