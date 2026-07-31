import crypto from 'crypto';

import { getIMSPool } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

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
  const centralReport = reportRuntimeIssue({
    businessId,
    source,
    operation: String(detail?.sync_type ?? dedupeKey).slice(0, 128),
    title,
    error: message,
    context: { ...(detail ?? {}), dedupe_key: dedupeKey },
  });
  const dedupeNeedle = `"dedupe_key":"${dedupeKey.replace(/"/g, '')}"`;
  const lockName = `notify:${crypto.createHash('sha256').update(`${businessId}:${source}:${dedupeKey}`).digest('hex').slice(0, 48)}`;
  const pool = getIMSPool();
  const connection = await pool.getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query<any[]>('SELECT GET_LOCK(?, 5) AS acquired', [lockName]);
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) return;

    const [existing] = await connection.query<any[]>(
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
    );
    if (existing.length > 0) return;

    await connection.execute(
      `INSERT INTO ims_notifications (business_id, type, source, title, message, detail)
       VALUES (?, 'error', ?, ?, ?, ?)`,
      [
        businessId,
        source.slice(0, 63),
        title.slice(0, 254),
        message.slice(0, 5000),
        JSON.stringify({ ...(detail ?? {}), dedupe_key: dedupeKey }),
      ],
    );
  } finally {
    if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    connection.release();
    await centralReport;
  }
}
