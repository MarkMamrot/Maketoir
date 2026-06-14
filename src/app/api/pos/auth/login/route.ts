import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosUsersRepo } from '@/lib/db/PosRepository';
import { imsQuery } from '@/services/IMSMySQLService';

// ─── In-memory brute-force protection ────────────────────────────────────────
// Keyed by normalised username. Resets on successful login.
// Safe for single-process cPanel/Passenger deployment.

const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutes

interface LoginAttemptEntry { count: number; lockedUntil: number; }
const loginAttempts = new Map<string, LoginAttemptEntry>();

function checkLockout(username: string): { locked: boolean; retryAfterSec: number } {
  const key   = username.trim().toLowerCase();
  const entry = loginAttempts.get(key);
  if (!entry) return { locked: false, retryAfterSec: 0 };
  if (entry.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSec: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  // Lockout expired — clean up
  loginAttempts.delete(key);
  return { locked: false, retryAfterSec: 0 };
}

function recordFailure(username: string): void {
  const key   = username.trim().toLowerCase();
  const entry = loginAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(key, entry);
}

function clearAttempts(username: string): void {
  loginAttempts.delete(username.trim().toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { username, password, location_id } = await req.json();

    if (!username || !password || !location_id) {
      return NextResponse.json({ error: 'username, password and location_id are required.' }, { status: 400 });
    }

    // Brute-force guard
    const lockout = checkLockout(username);
    if (lockout.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${Math.ceil(lockout.retryAfterSec / 60)} minute(s).` },
        { status: 429 },
      );
    }

    const user = await PosUsersRepo.findByUsername(username);
    if (!user || !user.is_active) {
      recordFailure(username);
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    const valid = await PosUsersRepo.verifyPassword(user, password);
    if (!valid) {
      recordFailure(username);
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    // Check branch access
    if (user.branch_ids && !user.branch_ids.includes(Number(location_id))) {
      recordFailure(username);
      return NextResponse.json({ error: 'Not authorised for this location.' }, { status: 403 });
    }

    // Successful login — clear any failed attempt counter
    clearAttempts(username);

    // Fetch location name
    const locations = await imsQuery<{ id: number; name: string }>(
      'SELECT id, name FROM ims_locations WHERE id = ? LIMIT 1',
      [location_id],
    );
    const locationName = locations[0]?.name ?? `Location ${location_id}`;

    const sessionData = {
      pos_user_id:   user.id,
      username:      user.username,
      full_name:     user.full_name ?? user.username,
      location_id:   Number(location_id),
      location_name: locationName,
    };

    cookies().set('pos_session', JSON.stringify(sessionData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 16, // 16-hour shift
      path: '/',
    });

    return NextResponse.json({ success: true, session: sessionData });
  } catch (err: any) {
    console.error('POS login error:', err);
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 });
  }
}
