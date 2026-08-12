import 'dotenv/config';

import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { appendManifestState, readManifest } from './support/manifest-store';

const command = process.argv[2];
if (!['acknowledge', 'block', 'report'].includes(command ?? '')) {
  throw new Error('Usage: npm run e2e:live:gate -- acknowledge|block|report [reason]');
}

const config = loadLiveE2EConfig();
if (config.action !== command && !(command === 'block' && config.action === 'inspect')) {
  throw new Error(`Live E2E blocked: LIVE_E2E_ACTION must equal ${command}.`);
}

if (command === 'acknowledge') {
  if (process.env.LIVE_E2E_OPERATOR_ACK !== 'I_REVIEWED_EXTERNAL_ARTIFACTS') {
    throw new Error('Live E2E blocked: set LIVE_E2E_OPERATOR_ACK=I_REVIEWED_EXTERNAL_ARTIFACTS after checking IMS and Xero.');
  }
  const operator = process.env.LIVE_E2E_OPERATOR_NAME?.trim();
  if (!operator) throw new Error('Live E2E blocked: LIVE_E2E_OPERATOR_NAME is required.');
  const event = await appendManifestState(config.runId, 'acknowledged', { operator });
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