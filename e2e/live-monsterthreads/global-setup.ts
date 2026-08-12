import { loadLiveE2EConfig } from '../../src/lib/liveE2E/safety';
import { runDatabasePreflight } from './support/database-preflight';

export default async function globalSetup() {
  const config = loadLiveE2EConfig();
  await runDatabasePreflight(config);
}