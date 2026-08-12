import { releaseDatabasePreflightLock } from './support/database-preflight';

export default async function globalTeardown() {
  await releaseDatabasePreflightLock();
}