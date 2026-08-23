import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { getPool } from '@/services/MySQLService';

export const ONLINE_SHOP_OTP_EXPIRES_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;

function secret(): string { const value = process.env.AUTH_SESSION_SECRET; if (!value || Buffer.byteLength(value) < 32) throw new Error('AUTH_SESSION_SECRET must be at least 32 bytes.'); return value; }
function tokenHash(token: string) { return createHmac('sha256', secret()).update(`native-shop-otp-token:${token}`).digest('hex'); }
function codeHash(token: string, code: string) { return createHmac('sha256', secret()).update(`native-shop-otp-code:${token}:${code.replace(/\s/g, '')}`).digest('hex'); }

export async function createOnlineShopOtp(input: { businessId: string; contactId: number; email: string }) {
  const challengeToken = randomBytes(32).toString('base64url'); const code = String(randomInt(1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + ONLINE_SHOP_OTP_EXPIRES_SECONDS * 1000); const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE online_shop_otp_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE business_id = ? AND email = ? AND consumed_at IS NULL', [input.businessId, input.email]);
    await connection.execute(`INSERT INTO online_shop_otp_challenges
      (business_id, email, contact_id, challenge_token_hash, code_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [input.businessId, input.email, input.contactId, tokenHash(challengeToken), codeHash(challengeToken, code), expiresAt]);
    await connection.commit(); return { challengeToken, code, expiresAt };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function verifyOnlineShopOtp(input: { businessId: string; challengeToken: string; code: unknown }) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<any[]>(`SELECT id, business_id, contact_id, email, code_hash, attempt_count, expires_at, consumed_at
      FROM online_shop_otp_challenges WHERE business_id = ? AND challenge_token_hash = ? LIMIT 1 FOR UPDATE`, [input.businessId, tokenHash(input.challengeToken)]);
    const row = rows[0]; const normalized = String(input.code ?? '').replace(/\s/g, '');
    if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now() || Number(row.attempt_count) >= MAX_ATTEMPTS) { await connection.commit(); return null; }
    const expected = Buffer.from(row.code_hash, 'hex'); const actual = Buffer.from(codeHash(input.challengeToken, normalized), 'hex');
    if (!/^\d{6}$/.test(normalized) || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await connection.execute('UPDATE online_shop_otp_challenges SET attempt_count = attempt_count + 1, consumed_at = IF(attempt_count + 1 >= ?, UTC_TIMESTAMP(3), consumed_at) WHERE id = ?', [MAX_ATTEMPTS, row.id]);
      await connection.commit(); return null;
    }
    await connection.execute('UPDATE online_shop_otp_challenges SET consumed_at = UTC_TIMESTAMP(3), verified_at = UTC_TIMESTAMP(3) WHERE id = ?', [row.id]);
    await connection.commit(); return { businessId: row.business_id, contactId: Number(row.contact_id), email: String(row.email) };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}