import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const RECOVERY_CODE_BYTES = 10;
const OPAQUE_TOKEN_BYTES = 32;

function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function hashMfaValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createOpaqueMfaToken(): { token: string; tokenHash: string } {
  const token = randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashMfaValue(token) };
}

export function createRecoveryCodes(count = 10): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) {
    throw new Error('Recovery code count must be an integer between 1 and 20.');
  }

  return Array.from({ length: count }, () => {
    const compact = randomBytes(RECOVERY_CODE_BYTES).toString('hex').toUpperCase();
    return compact.match(/.{1,5}/g)!.join('-');
  });
}

export function hashRecoveryCode(code: string): string {
  return hashMfaValue(normalizeRecoveryCode(code));
}

export function recoveryCodeMatches(code: string, expectedHash: string): boolean {
  const actualHash = Buffer.from(hashRecoveryCode(code), 'hex');
  let storedHash: Buffer;
  try {
    storedHash = Buffer.from(expectedHash, 'hex');
  } catch {
    return false;
  }
  return actualHash.length === storedHash.length && timingSafeEqual(actualHash, storedHash);
}