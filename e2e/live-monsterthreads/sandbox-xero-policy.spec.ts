import { expect, test } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';

test.describe.configure({ timeout: 120_000 });

test('@sandbox-xero-policy enables only bounded PO/SO document and payment sync', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.expectedBusinessId).toBe('biz_monsterthreads_sandbox');
  expect(config.expectedImsSchema).toBe('readyedu_MonsterthreadsSandboxIMS');
  await loginToIms(page, config);

  const policyResponse = await page.request.get(
    `/api/xero/document-policies?databaseId=${encodeURIComponent(config.expectedBusinessId)}`,
  );
  const current = await policyResponse.json() as { success?: boolean; policy?: Record<string, unknown>; error?: string };
  expect(policyResponse.ok(), current.error).toBe(true);
  expect(current.success, current.error).toBe(true);

  const policy = {
    ...current.policy,
    poApprovedAction: 'draft',
    poCompletedAction: 'authorised',
    poPaymentSyncEnabled: true,
    soApprovedAction: 'draft',
    soCompletedAction: 'authorised',
    soPaymentSyncEnabled: true,
  };
  const saveResponse = await page.request.put('/api/xero/document-policies', {
    data: { databaseId: config.expectedBusinessId, policy, presetSource: null },
  });
  const saved = await saveResponse.json() as {
    success?: boolean;
    changedFields?: Array<{ field: string }>;
    error?: string;
  };
  expect(saveResponse.ok(), saved.error).toBe(true);
  expect(saved.success, saved.error).toBe(true);
  expect((saved.changedFields ?? []).map(change => change.field).sort()).toEqual([
    'poApprovedAction',
    'poCompletedAction',
    'poPaymentSyncEnabled',
    'soApprovedAction',
    'soCompletedAction',
    'soPaymentSyncEnabled',
  ].sort());
});

test('@sandbox-xero-readiness reports bounded PO/SO mapping gaps', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.expectedBusinessId).toBe('biz_monsterthreads_sandbox');
  await loginToIms(page, config);

  const response = await page.request.get(
    `/api/xero/mapping-readiness?databaseId=${encodeURIComponent(config.expectedBusinessId)}`,
  );
  const result = await response.json() as {
    success?: boolean;
    summary?: unknown;
    items?: unknown[];
    error?: string;
  };
  expect(response.ok(), result.error).toBe(true);
  expect(result.success, result.error).toBe(true);
  console.log(JSON.stringify({ summary: result.summary, items: result.items }, null, 2));
});

test('@sandbox-xero-accounts reports safe mapping candidates', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.expectedBusinessId).toBe('biz_monsterthreads_sandbox');
  await loginToIms(page, config);

  const accountsResponse = await page.request.get(
    `/api/xero/accounts?databaseId=${encodeURIComponent(config.expectedBusinessId)}`,
  );
  const accountsResult = await accountsResponse.json() as {
    accounts?: Array<{ accountId: string; code: string; name: string; type: string; class: string; enablePaymentsToAccount: boolean }>;
    mappings?: unknown[];
    xeroError?: string;
  };
  expect(accountsResponse.ok(), accountsResult.xeroError).toBe(true);

  const methodsResponse = await page.request.get('/api/ims/payment-methods');
  const methodsResult = await methodsResponse.json() as { success?: boolean; data?: unknown[]; error?: string };
  expect(methodsResponse.ok(), methodsResult.error).toBe(true);
  expect(methodsResult.success, methodsResult.error).toBe(true);

  const candidates = (accountsResult.accounts ?? []).filter(account =>
    account.enablePaymentsToAccount
    || account.type === 'BANK'
    || ['ASSET', 'REVENUE'].includes(account.class),
  );
  console.log(JSON.stringify({ candidates, mappings: accountsResult.mappings, paymentMethods: methodsResult.data }, null, 2));
});

test('@sandbox-xero-mappings configures bounded document and payment accounts', async ({ page }) => {
  const config = loadLiveE2EConfig();
  expect(config.expectedBusinessId).toBe('biz_monsterthreads_sandbox');
  await loginToIms(page, config);

  const roleMappings = [
    { roleKey: 'inventory_asset', xeroAccountId: '2c4189ef-31d4-44ed-a295-1bf8908f97d4', xeroAccountCode: '630', xeroAccountName: 'Inventory' },
    { roleKey: 'inventory_in_transit', xeroAccountId: '2c4189ef-31d4-44ed-a295-1bf8908f97d4', xeroAccountCode: '630', xeroAccountName: 'Inventory' },
    { roleKey: 'sales_revenue', xeroAccountId: 'e2bacdc6-2006-43c2-a5da-3c0e5f43b452', xeroAccountCode: '200', xeroAccountName: 'Sales' },
  ];
  for (const mapping of roleMappings) {
    const response = await page.request.post('/api/xero/accounts', {
      data: { databaseId: config.expectedBusinessId, ...mapping },
    });
    const result = await response.json() as { success?: boolean; error?: string };
    expect(response.ok(), result.error).toBe(true);
    expect(result.success, result.error).toBe(true);
  }

  const methodsResponse = await page.request.get('/api/ims/payment-methods');
  const methodsResult = await methodsResponse.json() as {
    success?: boolean;
    data?: Array<{ id: number; name: string; type: 'po' | 'so' }>;
    error?: string;
  };
  expect(methodsResponse.ok(), methodsResult.error).toBe(true);
  expect(methodsResult.success, methodsResult.error).toBe(true);
  for (const method of methodsResult.data ?? []) {
    const response = await page.request.put('/api/ims/payment-methods', {
      data: { id: method.id, name: method.name, type: method.type, xero_account_code: '090' },
    });
    const result = await response.json() as { success?: boolean; error?: string };
    expect(response.ok(), result.error).toBe(true);
    expect(result.success, result.error).toBe(true);
  }

  const readinessResponse = await page.request.get(
    `/api/xero/mapping-readiness?databaseId=${encodeURIComponent(config.expectedBusinessId)}`,
  );
  const readiness = await readinessResponse.json() as {
    success?: boolean;
    summary?: { required: number; ready: number; missing: number; stale: number };
    error?: string;
  };
  expect(readinessResponse.ok(), readiness.error).toBe(true);
  expect(readiness.success, readiness.error).toBe(true);
  expect(readiness.summary).toMatchObject({ required: 8, ready: 8, missing: 0, stale: 0 });
});