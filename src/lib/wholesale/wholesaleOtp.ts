import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/services/MySQLService';

export const WHOLESALE_OTP_EXPIRES_SECONDS = 10 * 60;
export const WHOLESALE_OTP_MAX_ATTEMPTS = 5;

interface WholesaleOtpChallengeRow extends RowDataPacket {
  id: number;
  business_id: string;
  contact_id: number;
  email: string;
  code_hash: string;
  attempt_count: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

export interface WholesaleOtpChallenge {
  challengeToken: string;
  code: string;
  expiresAt: Date;
}

export type WholesaleOtpVerification =
  | { status: 'verified'; businessId: string; contactId: number; email: string }
  | { status: 'invalid' | 'expired' | 'attempts_exhausted' };

function signingSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('AUTH_SESSION_SECRET must be at least 32 bytes.');
  }
  return secret;
}

export function normalizeWholesaleOtpCode(code: unknown): string {
  return typeof code === 'string' ? code.replace(/\s/g, '') : '';
}

export function hashWholesaleOtpChallengeToken(token: string): string {
  return createHmac('sha256', signingSecret())
    .update(`wholesale-otp-token:${token}`, 'utf8')
    .digest('hex');
}

export function hashWholesaleOtpCode(challengeToken: string, code: string): string {
  return createHmac('sha256', signingSecret())
    .update(`wholesale-otp-code:${challengeToken}:${normalizeWholesaleOtpCode(code)}`, 'utf8')
    .digest('hex');
}

export function wholesaleOtpCodeMatches(challengeToken: string, code: unknown, expectedHash: string): boolean {
  const normalizedCode = normalizeWholesaleOtpCode(code);
  if (!/^\d{6}$/.test(normalizedCode) || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;

  const actual = Buffer.from(hashWholesaleOtpCode(challengeToken, normalizedCode), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createWholesaleOtpChallenge(input: {
  businessId: string;
  contactId: number;
  email: string;
  nowMs?: number;
}): Promise<WholesaleOtpChallenge> {
  const challengeToken = randomBytes(32).toString('base64url');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const nowMs = input.nowMs ?? Date.now();
  const expiresAt = new Date(nowMs + WHOLESALE_OTP_EXPIRES_SECONDS * 1000);
  const email = input.email.trim().toLowerCase();
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE wholesale_otp_challenges
          SET consumed_at = ?
        WHERE business_id = ? AND contact_id = ?
          AND consumed_at IS NULL AND expires_at > ?`,
      [new Date(nowMs), input.businessId, input.contactId, new Date(nowMs)],
    );
    await connection.execute(
      `INSERT INTO wholesale_otp_challenges
         (business_id, contact_id, email, challenge_token_hash, code_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.businessId,
        input.contactId,
        email,
        hashWholesaleOtpChallengeToken(challengeToken),
        hashWholesaleOtpCode(challengeToken, code),
        expiresAt,
      ],
    );
    await connection.commit();
    return { challengeToken, code, expiresAt };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function verifyWholesaleOtpChallenge(input: {
  challengeToken: string;
  code: unknown;
  businessId: string;
  nowMs?: number;
}): Promise<WholesaleOtpVerification> {
  const nowMs = input.nowMs ?? Date.now();
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<WholesaleOtpChallengeRow[]>(
      `SELECT id, business_id, contact_id, email, code_hash, attempt_count, expires_at, consumed_at
         FROM wholesale_otp_challenges
        WHERE challenge_token_hash = ? AND business_id = ?
        LIMIT 1
        FOR UPDATE`,
      [hashWholesaleOtpChallengeToken(input.challengeToken), input.businessId],
    );
    const challenge = rows[0];
    if (!challenge || challenge.consumed_at != null) {
      await connection.commit();
      return { status: 'invalid' };
    }
    if (new Date(challenge.expires_at).getTime() <= nowMs) {
      await connection.execute(
        'UPDATE wholesale_otp_challenges SET consumed_at = ? WHERE id = ?',
        [new Date(nowMs), challenge.id],
      );
      await connection.commit();
      return { status: 'expired' };
    }
    if (Number(challenge.attempt_count) >= WHOLESALE_OTP_MAX_ATTEMPTS) {
      await connection.commit();
      return { status: 'attempts_exhausted' };
    }

    if (!wholesaleOtpCodeMatches(input.challengeToken, input.code, challenge.code_hash)) {
      const nextAttemptCount = Number(challenge.attempt_count) + 1;
      await connection.execute(
        `UPDATE wholesale_otp_challenges
            SET attempt_count = ?, consumed_at = IF(? >= ?, ?, consumed_at)
          WHERE id = ?`,
        [
          nextAttemptCount,
          nextAttemptCount,
          WHOLESALE_OTP_MAX_ATTEMPTS,
          new Date(nowMs),
          challenge.id,
        ],
      );
      await connection.commit();
      return { status: nextAttemptCount >= WHOLESALE_OTP_MAX_ATTEMPTS ? 'attempts_exhausted' : 'invalid' };
    }

    await connection.execute(
      'UPDATE wholesale_otp_challenges SET consumed_at = ?, verified_at = ? WHERE id = ?',
      [new Date(nowMs), new Date(nowMs), challenge.id],
    );
    await connection.commit();
    return {
      status: 'verified',
      businessId: challenge.business_id,
      contactId: Number(challenge.contact_id),
      email: challenge.email,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}