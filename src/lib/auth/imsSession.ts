/**
 * Shared IMS session helper.
 *
 * Reads the marketoir_session cookie AND binds the logged-in business's IMS
 * schema to the current request (via AsyncLocalStorage) so every subsequent
 * IMS query routes to the correct per-business database. Call this at the top
 * of an IMS route instead of a local getSession().
 *
 * Backward compatible: if the business has no ims_db_name assigned, the env
 * default (IMS_MYSQL_DATABASE) remains in effect.
 */
import { cookies } from 'next/headers';
import { enterImsForBusiness } from '@/lib/db/BusinessRegistry';

export interface MarketoirSession {
  businessId: string;
  userId?: number;
  role?: string;
  tier?: string;
  email?: string;
  name?: string;
  company?: string;
}

/** Read the session cookie without touching IMS context. */
export function readSession(): MarketoirSession | null {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value) as MarketoirSession; } catch { return null; }
}

/** Read the session and bind the business's IMS schema for this request. */
export async function getImsSession(): Promise<MarketoirSession | null> {
  const session = readSession();
  if (session?.businessId) await enterImsForBusiness(session.businessId);
  return session;
}
