import fs from 'node:fs/promises';
import path from 'node:path';

import { appendLiveRunEvent } from '../../../src/lib/liveE2E/manifest';
import type { LiveRunEvent, LiveRunState } from '../../../src/lib/liveE2E/manifest';

function manifestPath(runId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/.test(runId)) throw new Error('Live E2E blocked: unsafe run ID.');
  return path.resolve('.live-e2e-runs', runId, 'manifest.jsonl');
}

export async function createManifest(runId: string, initialEvent: LiveRunEvent): Promise<void> {
  const filePath = manifestPath(runId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(initialEvent)}\n`, { flag: 'wx' });
}

export async function readManifest(runId: string): Promise<LiveRunEvent[]> {
  const content = await fs.readFile(manifestPath(runId), 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as LiveRunEvent);
}

export async function appendManifestState(runId: string, state: LiveRunState, details: unknown): Promise<LiveRunEvent> {
  const filePath = manifestPath(runId);
  const events = await readManifest(runId);
  const next = appendLiveRunEvent(events, state, details).at(-1)!;
  await fs.appendFile(filePath, `${JSON.stringify(next)}\n`, 'utf8');
  return next;
}