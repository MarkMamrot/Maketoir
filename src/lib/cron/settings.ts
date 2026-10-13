import { NextResponse } from 'next/server';
import { execute, query } from '@/services/MySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { CRON_JOBS, type CronJobId } from './catalog';

interface CronSetting {
  job_id: CronJobId;
  enabled: number;
  updated_by: number | null;
  updated_at: string;
}

let schemaReady: Promise<void> | undefined;

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = execute(`CREATE TABLE IF NOT EXISTS cron_job_settings (
      job_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      updated_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`).then(() => undefined).catch(error => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

export async function listCronJobSettings() {
  await ensureSchema();
  const rows = await query<CronSetting>('SELECT job_id, enabled, updated_by, updated_at FROM cron_job_settings');
  const settings = new Map(rows.map(row => [row.job_id, row]));
  return CRON_JOBS.map(job => {
    const setting = settings.get(job.id);
    return { ...job, enabled: setting ? Number(setting.enabled) === 1 : true, updatedBy: setting?.updated_by ?? null, updatedAt: setting?.updated_at ?? null };
  });
}

export async function setCronJobEnabled(jobId: CronJobId, enabled: boolean, userId: number): Promise<void> {
  await ensureSchema();
  await execute(
    `INSERT INTO cron_job_settings (job_id, enabled, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
    [jobId, enabled ? 1 : 0, userId],
  );
}

export async function checkCronJobEnabled(jobId: CronJobId): Promise<NextResponse | null> {
  try {
    await ensureSchema();
    const rows = await query<CronSetting>('SELECT enabled FROM cron_job_settings WHERE job_id = ?', [jobId]);
    if (rows.length && Number(rows[0].enabled) !== 1) {
      return NextResponse.json({ success: true, skipped: true, reason: 'cron_disabled', jobId });
    }
    return null;
  } catch (error) {
    await reportRuntimeIssue({ source: 'cron-jobs', operation: 'check_enabled', title: 'Cron job control could not be read', error, context: { jobId } }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Cron job control is temporarily unavailable.' }, { status: 503, headers: { 'Retry-After': '60' } });
  }
}