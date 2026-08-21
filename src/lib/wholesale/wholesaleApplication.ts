import { createHmac, randomBytes } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/services/MySQLService';

export const WHOLESALE_APPLICATION_VERIFICATION_SECONDS = 24 * 60 * 60;

export type WholesaleApplicationStatus = 'pending_email' | 'pending_review' | 'approving' | 'approved' | 'rejected';

export interface WholesaleApplicationInput {
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  abn: string | null;
  message: string | null;
  acceptedTerms: boolean;
}

interface ApplicationRow extends RowDataPacket {
  id: number;
  business_id: string;
  status: WholesaleApplicationStatus;
  verification_token_hash: string | null;
  verification_expires_at: Date | string | null;
}

export class WholesaleApplicationValidationError extends Error {}

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function normalizeWholesaleApplication(value: unknown): WholesaleApplicationInput {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const companyName = text(input.companyName, 255);
  const contactName = text(input.contactName, 255);
  const email = text(input.email, 320).toLowerCase();
  const phone = text(input.phone, 50) || null;
  const abn = text(input.abn, 32).replace(/\s+/g, '') || null;
  const message = text(input.message, 2_000) || null;
  const acceptedTerms = input.acceptedTerms === true;

  if (!companyName) throw new WholesaleApplicationValidationError('Company name is required.');
  if (!contactName) throw new WholesaleApplicationValidationError('Contact name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new WholesaleApplicationValidationError('A valid business email is required.');
  }
  if (abn && !/^\d{11}$/.test(abn)) {
    throw new WholesaleApplicationValidationError('ABN must contain 11 digits.');
  }
  if (!acceptedTerms) {
    throw new WholesaleApplicationValidationError('You must accept the wholesale application terms.');
  }
  return { companyName, contactName, email, phone, abn, message, acceptedTerms };
}

function secret(): string {
  const value = process.env.AUTH_SESSION_SECRET;
  if (!value || Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('AUTH_SESSION_SECRET must be at least 32 bytes.');
  }
  return value;
}

export function hashWholesaleApplicationToken(token: string): string {
  return createHmac('sha256', secret())
    .update(`wholesale-application:${token}`, 'utf8')
    .digest('hex');
}

export async function submitWholesaleApplication(input: {
  businessId: string;
  application: WholesaleApplicationInput;
  termsVersion: string;
  privacyVersion: string;
  nowMs?: number;
}): Promise<{ applicationId: number; verificationToken: string; expiresAt: Date; shouldSendVerification: boolean }> {
  const verificationToken = randomBytes(32).toString('base64url');
  const nowMs = input.nowMs ?? Date.now();
  const expiresAt = new Date(nowMs + WHOLESALE_APPLICATION_VERIFICATION_SECONDS * 1000);
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<ApplicationRow[]>(
      `SELECT id, business_id, status, verification_token_hash, verification_expires_at
         FROM wholesale_signup_requests
        WHERE business_id = ? AND email = ?
        LIMIT 1
        FOR UPDATE`,
      [input.businessId, input.application.email],
    );
    const existing = rows[0];
    if (existing && existing.status !== 'pending_email') {
      await connection.commit();
      return { applicationId: Number(existing.id), verificationToken: '', expiresAt, shouldSendVerification: false };
    }

    const params = [
      input.application.companyName,
      input.application.contactName,
      input.application.phone,
      input.application.abn,
      input.application.message,
      hashWholesaleApplicationToken(verificationToken),
      expiresAt,
      input.termsVersion,
      input.privacyVersion,
      new Date(nowMs),
    ];
    let applicationId: number;
    if (existing) {
      await connection.execute(
        `UPDATE wholesale_signup_requests
            SET company_name = ?, contact_name = ?, phone = ?, abn = ?, applicant_message = ?,
                verification_token_hash = ?, verification_expires_at = ?,
                terms_version = ?, privacy_version = ?, consented_at = ?, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND business_id = ?`,
        [...params, existing.id, input.businessId],
      );
      applicationId = Number(existing.id);
    } else {
      const [result] = await connection.execute(
        `INSERT INTO wholesale_signup_requests
           (business_id, company_name, contact_name, email, phone, abn, applicant_message,
            status, verification_token_hash, verification_expires_at,
            terms_version, privacy_version, consented_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_email', ?, ?, ?, ?, ?)`,
        [
          input.businessId,
          input.application.companyName,
          input.application.contactName,
          input.application.email,
          input.application.phone,
          input.application.abn,
          input.application.message,
          hashWholesaleApplicationToken(verificationToken),
          expiresAt,
          input.termsVersion,
          input.privacyVersion,
          new Date(nowMs),
        ],
      );
      applicationId = Number((result as { insertId: number }).insertId);
    }
    await connection.execute(
      `INSERT INTO wholesale_signup_review_events
         (application_id, business_id, event_type)
       VALUES (?, ?, 'submitted')`,
      [applicationId, input.businessId],
    );
    await connection.commit();
    return { applicationId, verificationToken, expiresAt, shouldSendVerification: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function verifyWholesaleApplication(input: {
  businessId: string;
  token: string;
  nowMs?: number;
}): Promise<'verified' | 'invalid' | 'expired' | 'already_processed'> {
  const nowMs = input.nowMs ?? Date.now();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<ApplicationRow[]>(
      `SELECT id, business_id, status, verification_token_hash, verification_expires_at
         FROM wholesale_signup_requests
        WHERE business_id = ? AND verification_token_hash = ?
        LIMIT 1
        FOR UPDATE`,
      [input.businessId, hashWholesaleApplicationToken(input.token)],
    );
    const application = rows[0];
    if (!application) {
      await connection.commit();
      return 'invalid';
    }
    if (application.status !== 'pending_email') {
      await connection.commit();
      return 'already_processed';
    }
    if (!application.verification_expires_at || new Date(application.verification_expires_at).getTime() <= nowMs) {
      await connection.commit();
      return 'expired';
    }

    await connection.execute(
      `UPDATE wholesale_signup_requests
          SET status = 'pending_review', email_verified_at = ?, verification_token_hash = NULL,
              verification_expires_at = NULL, updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND business_id = ? AND status = 'pending_email'`,
      [new Date(nowMs), application.id, input.businessId],
    );
    await connection.execute(
      `INSERT INTO wholesale_signup_review_events
         (application_id, business_id, event_type)
       VALUES (?, ?, 'email_verified')`,
      [application.id, input.businessId],
    );
    await connection.commit();
    return 'verified';
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}