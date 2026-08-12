import 'dotenv/config';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { verifyPurchaseOrderCompensation } from './support/database-preflight';
import { appendManifestState, readManifest } from './support/manifest-store';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!['acknowledge', 'retry-compensation', 'verify-clean', 'block', 'report'].includes(command ?? '')) {
    throw new Error('Usage: npm run e2e:live:gate -- acknowledge|retry-compensation|verify-clean|block|report [reason]');
  }

  const config = loadLiveE2EConfig();
  if (config.action !== command && !(command === 'block' && config.action === 'inspect')) {
    throw new Error(`Live E2E blocked: LIVE_E2E_ACTION must equal ${command}.`);
  }

  if (command === 'acknowledge' || command === 'retry-compensation' || command === 'verify-clean') {
    if (process.env.LIVE_E2E_OPERATOR_ACK !== 'I_REVIEWED_EXTERNAL_ARTIFACTS') {
      throw new Error('Live E2E blocked: set LIVE_E2E_OPERATOR_ACK=I_REVIEWED_EXTERNAL_ARTIFACTS after checking IMS and Xero.');
    }
    const operator = process.env.LIVE_E2E_OPERATOR_NAME?.trim();
    if (!operator) throw new Error('Live E2E blocked: LIVE_E2E_OPERATOR_NAME is required.');
    if (command === 'retry-compensation') {
      const events = await readManifest(config.runId);
      const blocked = events.at(-1);
      const previous = events.at(-2);
      if (blocked?.state !== 'blocked'
        || previous?.state !== 'compensating'
        || (blocked.details as any)?.phase !== 'compensation') {
        throw new Error('Live E2E blocked: compensation retry requires an immediately preceding failed compensation attempt.');
      }
    }
    if (command === 'verify-clean') {
      const events = await readManifest(config.runId);
      const blocked = events.at(-1);
      const previous = events.at(-2);
      if (blocked?.state !== 'blocked'
        || previous?.state !== 'compensating'
        || (blocked.details as any)?.phase !== 'compensation'
        || !String((blocked.details as any)?.error ?? '').includes('database preflight lock is not active')) {
        throw new Error('Live E2E blocked: clean verification recovery requires the exact post-compensation verifier failure.');
      }
      const poId = Number((blocked.details as any)?.purchaseOrderId);
      const authorized = await appendManifestState(config.runId, 'verification_authorized', { operator, purchaseOrderId: poId });
      const verification = await verifyPurchaseOrderCompensation(config, poId);
      const clean = await appendManifestState(config.runId, 'clean', {
        scenario: 'P1', purchaseOrderId: poId, ...verification,
        permanentArtifacts: ['Cancelled IMS purchase order and immutable activity/stock history', 'Voided Xero bill and Xero audit history'],
      });
      console.log(JSON.stringify({ authorized, clean }, null, 2));
      return;
    }
    const event = await appendManifestState(
      config.runId,
      command === 'acknowledge' ? 'acknowledged' : 'compensation_retry_authorized',
      { operator },
    );
    console.log(JSON.stringify(event, null, 2));
  } else if (command === 'block') {
    const reason = process.argv.slice(3).join(' ').trim();
    if (!reason) throw new Error('Live E2E blocked: a block reason is required.');
    const event = await appendManifestState(config.runId, 'blocked', { reason });
    console.log(JSON.stringify(event, null, 2));
  } else {
    const events = await readManifest(config.runId);
    console.log(JSON.stringify({ runId: config.runId, currentState: events.at(-1)?.state ?? null, events }, null, 2));
  }
}

void main();