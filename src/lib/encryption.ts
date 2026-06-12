/**
 * AES-256-GCM symmetric encryption for credentials stored in Google Sheets.
 * Key is read from ENCRYPTION_KEY env var (64-char hex = 32 bytes).
 * Each value gets a unique random IV, stored as: iv:authTag:ciphertext (all hex).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string in .env');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return '';
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Returns true only when the string matches the iv:authTag:ciphertext hex format. */
function isEncryptedFormat(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [ivHex, authTagHex] = parts;
  // IV must be 12 bytes (24 hex chars), auth tag must be 16 bytes (32 hex chars)
  return ivHex.length === 24 && authTagHex.length === 32 &&
    /^[0-9a-f]+$/i.test(ivHex) && /^[0-9a-f]+$/i.test(authTagHex);
}

export function decrypt(stored: string): string {
  if (!stored) return '';
  // If not in our encrypted format, return as plain text
  if (!isEncryptedFormat(stored)) return stored;
  const parts = stored.split(':');
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
