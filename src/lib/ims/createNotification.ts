/**
 * Persist an error/warning notification to ims_notifications.
 *
 * Designed for fire-and-forget usage at the call site:
 *   createNotification(bizId, 'pos_stock', 'POS Stock Failed', err.message, {...}).catch(console.error);
 */
import { imsExecute } from '@/services/IMSMySQLService';

export async function createNotification(
  businessId: string,
  source: string,
  title: string,
  message: string,
  detail?: Record<string, unknown> | null,
): Promise<void> {
  if (!businessId) return;
  await imsExecute(
    `INSERT INTO ims_notifications (business_id, type, source, title, message, detail)
     VALUES (?, 'error', ?, ?, ?, ?)`,
    [
      businessId,
      source.slice(0, 63),
      title.slice(0, 254),
      message.slice(0, 5000),
      detail != null ? JSON.stringify(detail) : null,
    ],
  );
}
