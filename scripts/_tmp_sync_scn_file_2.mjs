import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const scnId = 2;
const fileId = 2;

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('ENCRYPTION_KEY invalid');
  return Buffer.from(hex, 'hex');
}
function isEncryptedFormat(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 3) return false;
  const [ivHex, authTagHex] = parts;
  return ivHex.length === 24 && authTagHex.length === 32 && /^[0-9a-f]+$/i.test(ivHex) && /^[0-9a-f]+$/i.test(authTagHex);
}
function encrypt(plaintext) {
  if (!plaintext) return '';
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}
function decrypt(stored) {
  if (!stored) return '';
  if (!isEncryptedFormat(stored)) return stored;
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const key = getKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}
async function refreshAccessToken(refreshToken) {
  const basic = 'Basic ' + Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Refresh failed (${res.status}): ${text}`);
  return JSON.parse(text);
}
async function getValidAccess(main) {
  const [rows] = await main.execute('SELECT * FROM connections WHERE business_id = ? LIMIT 1', [businessId]);
  const row = rows[0];
  const accessToken = decrypt(row.xero_access_token || '');
  const refreshToken = decrypt(row.xero_refresh_token || '');
  const expiry = row.xero_token_expiry ? new Date(row.xero_token_expiry).getTime() : 0;
  if (accessToken && expiry > Date.now() + 60000) return { accessToken, tenantId: row.xero_tenant_id };
  const tokens = await refreshAccessToken(refreshToken);
  const newExpiry = new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await main.execute('UPDATE connections SET xero_access_token=?, xero_refresh_token=?, xero_token_expiry=?, updated_at=NOW() WHERE business_id=?', [encrypt(tokens.access_token), encrypt(tokens.refresh_token), newExpiry, businessId]);
  return { accessToken: tokens.access_token, tenantId: row.xero_tenant_id };
}

const main = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
const ims = await mysql.createConnection({ host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST, port: Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306), user: process.env.IMS_MYSQL_USER || process.env.MYSQL_USER, password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD, database: 'readyedu_MonsterthreadsIMS' });

const [scnRows] = await ims.execute('SELECT scn_number, xero_credit_note_id FROM ims_supplier_credit_notes WHERE id = ? AND business_id = ?', [scnId, businessId]);
const scn = scnRows[0];
if (!scn?.xero_credit_note_id) throw new Error('SCN is not synced to Xero');
const [fileRows] = await ims.execute('SELECT filename, original_name, mime_type FROM ims_supplier_credit_note_files WHERE id = ? AND scn_id = ? AND business_id = ?', [fileId, scnId, businessId]);
const file = fileRows[0];
if (!file) throw new Error('File not found');
const filePath = path.join(process.env.UPLOAD_BASE_PATH || './uploads', businessId, 'SCNs', scn.scn_number.replace(/[^a-zA-Z0-9_-]/g, '_'), file.filename);
if (!fs.existsSync(filePath)) throw new Error(`Missing file on disk: ${filePath}`);

const { accessToken, tenantId } = await getValidAccess(main);
const safeOriginalName = (file.original_name || file.filename).replace(/[^\w.\- ]/g, '_').slice(0, 120);
const url = `https://api.xero.com/api.xro/2.0/CreditNotes/${scn.xero_credit_note_id}/Attachments/${encodeURIComponent(safeOriginalName)}?IncludeOnline=true`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'xero-tenant-id': tenantId,
    'Content-Type': file.mime_type || 'application/octet-stream',
    Accept: 'application/json',
  },
  body: fs.readFileSync(filePath),
});
const text = await res.text();
console.log('status', res.status);
console.log(text);
if (!res.ok) throw new Error(`Upload failed (${res.status}): ${text}`);
await main.execute('INSERT INTO xero_sync_log (business_id, sync_type, reference_id, xero_id, status, xero_state, detail) VALUES (?, ?, ?, ?, ?, ?, ?)', [businessId, 'scn_attachment', scnId, scn.xero_credit_note_id, 'success', null, `file=${file.filename}; original=${safeOriginalName}; message=Attachment uploaded manually`]);
await ims.end();
await main.end();
