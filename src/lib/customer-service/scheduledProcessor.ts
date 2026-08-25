import { randomUUID } from 'crypto';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { processCustomerServiceInbox } from './aiPipeline';
import { sendCustomerServiceReply } from './replyActions';
import { getCustomerServiceSettings } from './repository';
import { getDueCustomerServiceSchedule } from './schedule';
import { syncCustomerServiceMailbox } from './syncMailbox';
import { curateCustomerServiceLearnings } from './learningCurator';

export interface ScheduledCustomerServiceResult {
  skipped?: string;
  syncedThreads: number;
  syncedMessages: number;
  classified: number;
  drafted: number;
  sent: number;
  failed: number;
}

export async function runScheduledCustomerService(businessId: string, force = false): Promise<ScheduledCustomerServiceResult> {
  const settings = await getCustomerServiceSettings(businessId);
  const empty = { syncedThreads: 0, syncedMessages: 0, classified: 0, drafted: 0, sent: 0, failed: 0 };
  if (!settings.enabled && !force) return { ...empty, skipped: 'disabled' };
  const due = getDueCustomerServiceSchedule({
    now: new Date(),
    lastRunAt: settings.lastRunAt ? new Date(settings.lastRunAt.replace(' ', 'T') + 'Z') : null,
    timeZone: settings.timezone,
    runTimes: settings.runTimes,
  });
  if (!force && !due.due) return { ...empty, skipped: 'not_due' };

  const lockOwner = randomUUID();
  const claim = await imsExecute(
    `UPDATE ims_cs_settings SET lock_owner = ?, lock_claimed_at = UTC_TIMESTAMP()
      WHERE business_id = ? AND (lock_owner IS NULL OR lock_claimed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))`,
    [lockOwner, businessId],
  );
  if (!claim.affectedRows) return { ...empty, skipped: 'already_running' };

  const startedAt = Date.now();
  const run = await imsExecute(
    `INSERT INTO ims_cs_processing_runs
      (business_id, run_type, trigger_type, status, counts_json, started_at)
     VALUES (?, 'sync', ?, 'running', '{}', UTC_TIMESTAMP())`,
    [businessId, force ? 'manual' : 'schedule'],
  );
  const result: ScheduledCustomerServiceResult = { ...empty };
  try {
    const sync = await syncCustomerServiceMailbox(businessId, { days: settings.lookbackDays });
    result.syncedThreads = sync.threads;
    result.syncedMessages = sync.messages;
    const processed = await processCustomerServiceInbox(businessId);
    result.classified = processed.classified;
    result.drafted = processed.drafted;

    if (settings.mode === 'send') {
      const drafts = await imsQuery<{ id: number }>(
        `SELECT id FROM ims_cs_drafts
          WHERE business_id = ? AND status = 'generated' ORDER BY id LIMIT 40`,
        [businessId],
      );
      for (const draft of drafts) {
        try {
          await sendCustomerServiceReply(businessId, draft.id);
          result.sent++;
        } catch {
          result.failed++;
        }
      }
    }

    await curateCustomerServiceLearnings(businessId);

    if (settings.retentionMode === 'limited') {
      await cleanupCustomerServiceRetention(businessId, settings.retentionDays);
    }
    await imsExecute(
      `UPDATE ims_cs_processing_runs SET status = ?, counts_json = ?, completed_at = UTC_TIMESTAMP(), duration_ms = ?
        WHERE business_id = ? AND id = ?`,
      [result.failed ? 'partial' : 'success', JSON.stringify(result), Date.now() - startedAt, businessId, run.insertId],
    );
    await imsExecute(
      `UPDATE ims_cs_settings SET last_run_at = UTC_TIMESTAMP(), last_error = NULL,
         lock_owner = NULL, lock_claimed_at = NULL WHERE business_id = ? AND lock_owner = ?`,
      [businessId, lockOwner],
    );
    return result;
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 4000);
    await imsExecute(
      `UPDATE ims_cs_processing_runs SET status = 'error', error_message = ?, counts_json = ?,
         completed_at = UTC_TIMESTAMP(), duration_ms = ? WHERE business_id = ? AND id = ?`,
      [message, JSON.stringify(result), Date.now() - startedAt, businessId, run.insertId],
    ).catch(() => {});
    await imsExecute(
      `UPDATE ims_cs_settings SET last_error = ?, lock_owner = NULL, lock_claimed_at = NULL
        WHERE business_id = ? AND lock_owner = ?`,
      [message, businessId, lockOwner],
    ).catch(() => {});
    throw error;
  }
}

export async function cleanupCustomerServiceRetention(businessId: string, retentionDays = 90): Promise<void> {
  const days = [90, 180, 365].includes(Number(retentionDays)) ? Number(retentionDays) : 90;
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const params = [businessId, days];
    await connection.execute(
      `DELETE r FROM ims_cs_draft_revisions r
        JOIN ims_cs_drafts d ON d.business_id = r.business_id AND d.id = r.draft_id
        JOIN ims_cs_threads t ON t.business_id = d.business_id AND t.id = d.thread_id
       WHERE t.business_id = ? AND t.last_message_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      params,
    );
    await connection.execute(
      `DELETE d FROM ims_cs_drafts d
        JOIN ims_cs_threads t ON t.business_id = d.business_id AND t.id = d.thread_id
       WHERE t.business_id = ? AND t.last_message_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      params,
    );
    await connection.execute(
      `DELETE e FROM ims_cs_events e
        JOIN ims_cs_threads t ON t.business_id = e.business_id AND t.id = e.thread_id
       WHERE t.business_id = ? AND t.last_message_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      params,
    );
    await connection.execute(
      `DELETE m FROM ims_cs_messages m
        JOIN ims_cs_threads t ON t.business_id = m.business_id AND t.id = m.thread_id
       WHERE t.business_id = ? AND t.last_message_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      params,
    );
    await connection.execute(
      `DELETE FROM ims_cs_threads WHERE business_id = ?
        AND last_message_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      params,
    );
    await connection.execute(
      'DELETE FROM ims_cs_learning_evidence WHERE business_id = ? AND expires_at IS NOT NULL AND expires_at < UTC_TIMESTAMP()',
      [businessId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}