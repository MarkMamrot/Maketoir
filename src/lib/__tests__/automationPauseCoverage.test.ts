import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const scheduledBusinessSelectors = [
  'src/app/api/customer-service/auto-reply/route.ts',
  'src/app/api/customer-service/sync-cron/route.ts',
  'src/app/api/foresight/digests/cron/route.ts',
  'src/app/api/ims/online-sales/auto-sync-cron/route.ts',
  'src/app/api/ims/shopify/sync-inventory/route.ts',
  'src/app/api/xero/cogs/cron/route.ts',
  'src/app/api/xero/reconciliation/cron/route.ts',
  'src/app/api/xero/reconciliation/digest-cron/route.ts',
  'src/app/api/xero/shopify-payouts/catchup-cron/route.ts',
];

describe('shared scheduler sandbox isolation', () => {
  it.each(scheduledBusinessSelectors)('%s excludes automation-paused businesses', (relativePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

    expect(source).toMatch(/COALESCE\((?:b\.)?automation_paused, 0\) = 0/);
  });
});
