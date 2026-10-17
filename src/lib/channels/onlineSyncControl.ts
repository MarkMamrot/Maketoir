import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import type { OnlineSyncRollout } from './onlineSyncPolicy';
import { OnlineSyncLeaseLostError, OnlineSyncValidationError } from './onlineSyncPolicy';

export async function assertOnlineRecoveryBusinessActive(businessId: string): Promise<void> {
  const rows = await query<{ business_id: string }>(
    `SELECT business_id FROM businesses WHERE business_id = ? AND deleted_at IS NULL
      AND COALESCE(automation_paused,0) = 0`, [businessId],
  );
  if (rows.length !== 1) throw new OnlineSyncLeaseLostError();
}

export interface OnlineSyncControl {
  mode: OnlineSyncRollout;
  paused: boolean;
  installed: boolean;
  lastRunAt?: string;
}

// Explicit absence means this tenant has not been migrated/activated, not a failed query.
export async function getOnlineSyncControl(businessId: string): Promise<OnlineSyncControl> {
  const tables = await imsQuery<{ present: number }>(
    `SELECT 1 AS present FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_online_sync_control'`,
    [],
  );
  if (!tables.length) return { mode: 'legacy', paused: false, installed: false };
  const rows = await imsQuery<{ rollout_state: string; paused: number; last_run_at?: string }>(
    `SELECT rollout_state, paused, DATE_FORMAT(last_run_at,'%Y-%m-%dT%H:%i:%sZ') AS last_run_at
       FROM ims_online_sync_control WHERE business_id = ?`, [businessId],
  );
  if (!rows.length) return { mode: 'legacy', paused: false, installed: true };
  const mode = rows[0].rollout_state;
  if (mode !== 'legacy' && mode !== 'validation' && mode !== 'cutover') {
    throw new OnlineSyncValidationError('Invalid persisted online recovery rollout state.');
  }
  return {
    mode, paused: Number(rows[0].paused) === 1, installed: true,
    ...(rows[0].last_run_at ? { lastRunAt: rows[0].last_run_at } : {}),
  };
}
