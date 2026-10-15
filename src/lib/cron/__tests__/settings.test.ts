import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), report: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { CRON_JOBS, findCronJob } from '../catalog';
import { checkCronJobEnabled, listCronJobSettings, setCronJobEnabled } from '../settings';

describe('platform cron controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
    mocks.execute.mockResolvedValue({});
    mocks.report.mockResolvedValue(null);
  });

  it('keeps existing defaults on and delivery evidence off without writing settings', async () => {
    const jobs = await listCronJobSettings();
    expect(jobs).toHaveLength(CRON_JOBS.length);
    expect(jobs.filter(job => job.id !== 'amazon-delivery-tracking').every(job => job.enabled)).toBe(true);
    expect(jobs.find(job => job.id === 'amazon-delivery-tracking')?.enabled).toBe(false);
    expect(mocks.execute.mock.calls.every(call => !call[0].startsWith('INSERT'))).toBe(true);
  });

  it('reads stored off states without changing unrelated jobs', async () => {
    mocks.query.mockResolvedValue([{ job_id: 'database-backup', enabled: 0, updated_by: 1, updated_at: '2026-10-13' }]);
    const jobs = await listCronJobSettings();
    expect(jobs.find(job => job.id === 'database-backup')).toMatchObject({ enabled: false, updatedBy: 1 });
    expect(jobs.find(job => job.id === 'cogs-sync')?.enabled).toBe(true);
  });

  it.each([true, false])('persists only the selected master flag and its actor (%s)', async enabled => {
    await setCronJobEnabled('database-backup', enabled, 42);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO cron_job_settings'), ['database-backup', enabled ? 1 : 0, 42]);
  });

  it('allows an unconfigured job to run', async () => {
    expect(await checkCronJobEnabled('database-backup')).toBeNull();
  });

  it('keeps unconfigured delivery tracking off until explicitly enabled', async () => {
    expect(await (await checkCronJobEnabled('amazon-delivery-tracking'))?.json()).toMatchObject({ skipped: true });
    mocks.query.mockResolvedValueOnce([{ enabled: 1 }]);
    expect(await checkCronJobEnabled('amazon-delivery-tracking')).toBeNull();
  });

  it('returns a successful skip for a disabled job', async () => {
    mocks.query.mockResolvedValue([{ enabled: 0 }]);
    const response = await checkCronJobEnabled('database-backup');
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ skipped: true, reason: 'cron_disabled', jobId: 'database-backup' });
  });

  it('fails closed with a visible retryable error when the control cannot be read', async () => {
    mocks.query.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await checkCronJobEnabled('database-backup');
    expect(response?.status).toBe(503);
    expect(response?.headers.get('Retry-After')).toBe('60');
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ source: 'cron-jobs', context: { jobId: 'database-backup' } }));
  });

  it('has unique stable job identifiers and rejects unknown identifiers', () => {
    expect(new Set(CRON_JOBS.map(job => job.id)).size).toBe(CRON_JOBS.length);
    expect(findCronJob('__proto__')).toBeUndefined();
    expect(findCronJob(null)).toBeUndefined();
    expect(findCronJob('marketing-daily')?.schedule).toBe('35 20 * * *');
  });

  it('catalogues every repository scheduled workflow and its target endpoints', () => {
    const directory = join(process.cwd(), '.github', 'workflows');
    const workflows = readdirSync(directory).filter(filename => filename.endsWith('.yml'));
    const sources = new Map(workflows.map(filename => [filename, readFileSync(join(directory, filename), 'utf8')]));
    const scheduled = workflows.filter(filename => sources.get(filename)?.includes('\n  schedule:'));
    expect(new Set(CRON_JOBS.flatMap(job => job.workflow ? [job.workflow] : []))).toEqual(new Set(scheduled));
    for (const job of CRON_JOBS) {
      if (job.workflow) expect(sources.get(job.workflow)).toContain(job.path);
    }
  });
});