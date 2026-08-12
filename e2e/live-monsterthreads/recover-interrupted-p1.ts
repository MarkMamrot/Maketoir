import 'dotenv/config';

import { chromium, expect } from '@playwright/test';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { loginToIms } from './support/auth';
import { readManifest } from './support/manifest-store';

async function main(): Promise<void> {
  const config = loadLiveE2EConfig();
  const poId = Number(process.env.LIVE_E2E_RECOVERY_PO_ID);
  if (!Number.isInteger(poId) || poId <= 0) throw new Error('Live E2E blocked: LIVE_E2E_RECOVERY_PO_ID must be a positive integer.');

  const events = await readManifest(config.runId);
  if (events.at(-1)?.state !== 'blocked') throw new Error('Live E2E blocked: recovery requires a blocked manifest.');

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: config.baseUrl });
  try {
    await loginToIms(page, config);
    const beforeResponse = await page.request.get(`/api/ims/purchase-orders/${poId}`);
    const before = (await beforeResponse.json())?.data;
    const lines = Array.isArray(before?.items) ? before.items : [];
    if (!beforeResponse.ok() || !before
      || before.status !== 'confirmed'
      || Number(before.location_id) !== config.fixtureLocationId
      || Number(before.total_amount) > config.maxDocumentTotal
      || !String(before.notes ?? '').includes(`LIVE E2E ${config.runId} P1`)
      || lines.length !== 1
      || String(lines[0].variant_id) !== config.fixtureVariantId
      || Number(lines[0].qty_received) !== 0) {
      throw new Error('Live E2E blocked: interrupted PO does not match the exact unreceived P1 artifact contract.');
    }

    await page.getByTestId('ims-nav-__orders').click();
    await page.getByTestId('ims-nav-purchase-orders').click();
    await page.getByTestId(`po-open-${poId}`).click();
    page.once('dialog', dialog => dialog.accept());
    const cancelResponse = page.waitForResponse(response => response.url().endsWith(`/api/ims/purchase-orders/${poId}`)
      && response.request().method() === 'PUT');
    await page.getByTestId(`po-cancel-${poId}`).click();
    const cancelled = await (await cancelResponse).json() as { success?: boolean; xeroWarning?: string; error?: string };
    expect(cancelled.success, cancelled.error).toBe(true);
    expect(cancelled.xeroWarning, 'Xero reported a cancellation warning').toBeUndefined();
    const after = (await (await page.request.get(`/api/ims/purchase-orders/${poId}`)).json())?.data;
    expect(after?.status).toBe('cancelled');
    console.log(JSON.stringify({ recovered: true, purchaseOrderId: poId, purchaseOrderNumber: after?.po_number, status: after?.status }, null, 2));
  } finally {
    await browser.close();
  }
}

void main();