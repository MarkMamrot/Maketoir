import { imsQuery } from '@/services/IMSMySQLService';
import { createNotification } from '@/lib/ims/createNotification';

interface SyncFailureNotificationOptions {
  businessId: string;
  source: string;
  title: string;
  message: string;
  detail?: Record<string, unknown>;
  dedupeKey: string;
  dedupeMinutes?: number;
}

function clampDedupeWindow(value: number | undefined): number {
  const n = Number(value ?? 60);
  if (!Number.isFinite(n)) return 60;
  return Math.max(1, Math.min(24 * 60, Math.floor(n)));
}

/**
 * Creates an IMS notification for sync failures with a short dedupe window.
 * This prevents retry storms from spamming the same failure repeatedly.
 */
export async function notifySyncFailure(options: SyncFailureNotificationOptions): Promise<void> {
  const {
    businessId,
    source,
    title,
    message,
    detail,
    dedupeKey,
    dedupeMinutes,
  } = options;

  if (!businessId || !dedupeKey) return;

  const windowMins = clampDedupeWindow(dedupeMinutes);
  const dedupeNeedle = `"dedupe_key":"${dedupeKey.replace(/"/g, '')}"`;

  const existing = await imsQuery<{ id: number }>(
    `SELECT id
       FROM ims_notifications
      WHERE business_id = ?
        AND source = ?
        AND title = ?
        AND detail LIKE ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${windowMins} MINUTE)
      ORDER BY id DESC
      LIMIT 1`,
    [businessId, source, title, `%${dedupeNeedle}%`],
  ).catch(() => []);

  if (existing.length > 0) return;

  await createNotification(
    businessId,
    source,
    title,
    message,
    { ...(detail ?? {}), dedupe_key: dedupeKey },
    'error',
  );
}
