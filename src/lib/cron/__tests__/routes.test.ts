import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { CRON_JOBS } from '../catalog';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/cron/settings', () => ({ checkCronJobEnabled: mocks.gate }));
vi.mock('@/lib/channels/onlineRecoveryWorker', () => ({
  runOnlineRecoveryDispatch: vi.fn(), requestOnlineRecovery: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute, getPool: vi.fn() }));
vi.mock('@/services/GoogleSheetsService', () => ({ GoogleSheetsService: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: vi.fn(), imsExecute: vi.fn(), getIMSPool: vi.fn() }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: vi.fn(), enterImsForBusiness: vi.fn() }));
vi.mock('@/lib/foresight/ForesightDigestService', () => ({
  ForesightDigestService: { generateDaily: vi.fn(), generateWeekly: vi.fn() },
}));
vi.mock('@/lib/foresight/ForesightOutcomeService', () => ({
  ForesightOutcomeService: { evaluateDuePaidMedia: vi.fn(), evaluateDueCampaigns: vi.fn() },
}));
vi.mock('@/lib/foresight/ForesightMonitoringSyncService', () => ({
  ForesightMonitoringSyncService: { syncActiveWindow: vi.fn() },
}));
vi.mock('@/lib/foresight/ForesightExperimentEvidenceCollectionService', () => ({
  ForesightExperimentEvidenceCollectionService: { collectDue: vi.fn() },
}));

const routeLoaders: Record<string, () => Promise<any>> = {
  'database-backup': () => import('../../../app/api/admin/backup/route'),
  'ai-billing-maintenance': () => import('../../../app/api/cron/ai-billing-maintenance/route'),
  'prospect-conversations': () => import('../../../app/api/cron/prospect-conversations/route'),
  'shopify-inventory': () => import('../../../app/api/ims/shopify/sync-inventory/route'),
  'klaviyo-outbox': () => import('../../../app/api/klaviyo/outbox/cron/route'),
  'cogs-sync': () => import('../../../app/api/xero/cogs/cron/route'),
  'online-sales': () => import('../../../app/api/ims/online-sales/auto-sync-cron/route'),
  'online-recovery': () => import('../../../app/api/ims/online-sales/recovery-cron/route'),
  'marketing-daily': () => import('../../../app/api/foresight/digests/cron/route'),
  'marketing-weekly': () => import('../../../app/api/foresight/digests/cron/route'),
  'amazon-orders': () => import('../../../app/api/ims/channels/amazon/orders/cron/route'),
  'amazon-fulfilments': () => import('../../../app/api/ims/channels/amazon/fulfilments/cron/route'),
  'amazon-delivery-tracking': () => import('../../../app/api/ims/channels/amazon/delivery/cron/route'),
  'amazon-returns': () => import('../../../app/api/ims/channels/amazon/returns/cron/route'),
  'amazon-inventory': () => import('../../../app/api/ims/channels/amazon/inventory/cron/route'),
  'product-publication': () => import('../../../app/api/ims/channels/product-publication/cron/route'),
  'product-assignment': () => import('../../../app/api/ims/channels/product-assignment/cron/route'),
  'xero-reconciliation': () => import('../../../app/api/xero/reconciliation/cron/route'),
  'xero-reconciliation-digest': () => import('../../../app/api/xero/reconciliation/digest-cron/route'),
  'shopify-payouts': () => import('../../../app/api/xero/shopify-payouts/catchup-cron/route'),
  'shopify-gift-cards': () => import('../../../app/api/ims/shopify/gift-cards/reconcile-cron/route'),
  'shopify-fulfilments': () => import('../../../app/api/ims/shopify/orders/reconcile-fulfilments-cron/route'),
  'customer-service-sync': () => import('../../../app/api/customer-service/sync-cron/route'),
  'runtime-issues-digest': () => import('../../../app/api/admin/runtime-issues/digest-cron/route'),
};

const connectedJobs = CRON_JOBS.filter(job => job.id in routeLoaders);

describe('cron route master gates', () => {
  it('covers every job in the Admin catalogue', () => {
    expect(connectedJobs).toHaveLength(CRON_JOBS.length);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    vi.stubEnv('BACKUP_SECRET', 'test-backup-secret');
    mocks.gate.mockImplementation(async (jobId: string) => NextResponse.json({ success: true, skipped: true, reason: 'cron_disabled', jobId }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(connectedJobs)('skips $id before database or provider work', async job => {
    const route = await routeLoaders[job.id]();
    const request = new Request(`http://localhost${job.path}`, {
      method: job.method,
      headers: { 'x-cron-secret': 'test-cron-secret', authorization: 'Bearer test-backup-secret', 'Content-Type': 'application/json' },
      ...(job.method === 'POST' ? { body: JSON.stringify('digestType' in job ? { digestType: job.digestType } : {}) } : {}),
    });
    const response = await route[job.method](request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: true, jobId: job.id });
    expect(mocks.gate).toHaveBeenCalledWith(job.id);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('does not read platform flags for unauthenticated cron requests', async () => {
    const { POST } = await import('../../../app/api/foresight/digests/cron/route');
    expect((await POST(new Request('http://localhost/api/foresight/digests/cron', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect(mocks.gate).not.toHaveBeenCalled();
  });
});