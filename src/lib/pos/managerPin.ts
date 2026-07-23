import bcrypt from 'bcryptjs';
import { imsQuery } from '@/services/IMSMySQLService';
import { checkRateLimit, registerFailure, clearRateLimit } from '@/lib/posRateLimit';

export type ManagerPinResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Verifies a location's manager PIN (bcrypt-hashed on ims_locations.manager_pin_hash,
 * set via IMS → Locations → Edit Location). Rate-limited per location the same way
 * as staff PIN login, to slow brute-forcing.
 *
 * Used both by the dedicated verify endpoint (fast UI feedback) AND by the
 * transaction edit/void endpoints themselves (defense in depth — a client
 * can't skip verification just by calling the mutating endpoint directly).
 */
export async function verifyManagerPin(locationId: number, pin: unknown): Promise<ManagerPinResult> {
  if (pin == null || String(pin).trim() === '') {
    return { ok: false, error: 'Manager PIN is required.', status: 400 };
  }

  const rlKey = `mgrpin:${locationId}`;
  const rl = checkRateLimit(rlKey);
  if (rl.locked) {
    return {
      ok: false,
      status: 429,
      error: `Too many incorrect attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`,
    };
  }

  const rows = await imsQuery<{ manager_pin_hash: string | null }>(
    'SELECT manager_pin_hash FROM ims_locations WHERE id = ? LIMIT 1',
    [locationId],
  );
  const hash = rows[0]?.manager_pin_hash ?? null;
  if (!hash) {
    return { ok: false, error: 'No manager PIN has been set for this location.', status: 403 };
  }

  const match = await bcrypt.compare(String(pin), hash);
  if (!match) {
    const after = registerFailure(rlKey);
    return {
      ok: false,
      status: after.locked ? 429 : 403,
      error: after.locked
        ? `Too many incorrect attempts. Try again in ${Math.ceil(after.retryAfterSec / 60)} minute(s).`
        : 'Incorrect manager PIN.',
    };
  }

  clearRateLimit(rlKey);
  return { ok: true };
}
