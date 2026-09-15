import { amazonReturnEventId, type AmazonReturnObservation } from '@/lib/channels/amazonReturnReport';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export async function importAmazonReturnObservations(input: {
  businessId: string;
  channelInstanceId: string;
  observations: AmazonReturnObservation[];
}): Promise<{ observed: number; ignored: number }> {
  let observed = 0;
  let ignored = 0;
  for (const observation of input.observations) {
    const orders = await imsQuery<{ id: number }>(
      `SELECT id FROM ims_sales_orders
        WHERE business_id = ? AND sales_channel = 'amazon' AND channel_instance_id = ? AND external_order_id = ?
        LIMIT 1`,
      [input.businessId, input.channelInstanceId, observation.amazonOrderId],
    );
    await imsExecute(
      `INSERT INTO ims_sales_channel_events
         (business_id, channel_instance_id, provider, event_type, external_event_id, occurred_at,
          payload_json, status, attempts, processed_at)
       VALUES (?, ?, 'amazon', 'return.observed', ?, ?, ?, 'complete', 1, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE occurred_at = VALUES(occurred_at), payload_json = VALUES(payload_json),
         status = 'complete', attempts = attempts + 1, safe_error = NULL, processed_at = CURRENT_TIMESTAMP(3)`,
      [input.businessId, input.channelInstanceId, amazonReturnEventId(observation), observation.requestedAt,
        JSON.stringify({ ...observation, salesOrderId: orders[0]?.id ?? null })],
    );
    observed += 1;
    if (!orders[0]) ignored += 1;
  }
  return { observed, ignored };
}