import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createDecipheriv, createCipheriv, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

const MAIN_DB = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

function getImsConfig(database) {
  return {
    host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.IMS_MYSQL_USER || process.env.MYSQL_USER,
    password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
    database,
  };
}

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('ENCRYPTION_KEY invalid');
  return Buffer.from(hex, 'hex');
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

function isEncryptedFormat(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 3) return false;
  const [ivHex, authTagHex] = parts;
  return ivHex.length === 24 && authTagHex.length === 32 && /^[0-9a-f]+$/i.test(ivHex) && /^[0-9a-f]+$/i.test(authTagHex);
}

function decrypt(stored) {
  if (!stored) return '';
  if (!isEncryptedFormat(stored)) return stored;
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const key = getKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.XERO_CLIENT_ID || '';
  const clientSecret = process.env.XERO_CLIENT_SECRET || '';
  const basic = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basic,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Refresh failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function getValidAccess(main, businessId) {
  const [rows] = await main.execute('SELECT * FROM connections WHERE business_id = ? LIMIT 1', [businessId]);
  const row = rows[0];
  if (!row?.xero_refresh_token || !row?.xero_tenant_id) throw new Error('No Xero connection');
  const accessToken = decrypt(row.xero_access_token || '');
  const refreshToken = decrypt(row.xero_refresh_token || '');
  const expiry = row.xero_token_expiry ? new Date(row.xero_token_expiry).getTime() : 0;
  if (accessToken && expiry > Date.now() + 60000) return { accessToken, tenantId: row.xero_tenant_id };
  const tokens = await refreshAccessToken(refreshToken);
  const newExpiry = new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await main.execute(
    'UPDATE connections SET xero_access_token = ?, xero_refresh_token = ?, xero_token_expiry = ?, updated_at = NOW() WHERE business_id = ?',
    [encrypt(tokens.access_token), encrypt(tokens.refresh_token), newExpiry, businessId],
  );
  return { accessToken: tokens.access_token, tenantId: row.xero_tenant_id };
}

async function xeroApiFetch(main, businessId, pathName, options = {}) {
  const { accessToken, tenantId } = await getValidAccess(main, businessId);
  const url = `https://api.xero.com/api.xro/2.0${pathName}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Xero API ${options.method || 'GET'} ${pathName} failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

function parseValidation(msg) {
  const out = [];
  let duplicateNumber = false;
  try {
    const i = msg.indexOf('{');
    if (i >= 0) {
      const parsed = JSON.parse(msg.slice(i));
      for (const el of parsed.Elements || []) {
        for (const ve of el.ValidationErrors || []) out.push(String(ve.Message || '').trim());
        for (const li of el.LineItems || []) {
          for (const ve of li.ValidationErrors || []) out.push(String(ve.Message || '').trim());
        }
      }
    }
  } catch {}
  const summary = out.join(' | ') || msg;
  duplicateNumber = /invoice number|credit note number|already been used|must be unique|duplicate/i.test(summary);
  return { summary, duplicateNumber };
}

async function uploadAttachments(main, ims, businessId, scnId, scnNumber, xeroCreditNoteId) {
  const [files] = await ims.execute('SELECT filename, original_name, mime_type FROM ims_supplier_credit_note_files WHERE scn_id = ? AND business_id = ? ORDER BY uploaded_at ASC', [scnId, businessId]).catch(() => [[]]);
  if (!files.length) return;
  const { accessToken, tenantId } = await getValidAccess(main, businessId);
  const dir = path.join(process.env.UPLOAD_BASE_PATH || './uploads', businessId, 'SCNs', scnNumber.replace(/[^a-zA-Z0-9_-]/g, '_'));
  for (const f of files) {
    const filePath = path.join(dir, f.filename);
    if (!fs.existsSync(filePath)) continue;
    const safeOriginalName = (f.original_name || f.filename).replace(/[^\w.\- ]/g, '_').slice(0, 120);
    const url = `https://api.xero.com/api.xro/2.0/CreditNotes/${xeroCreditNoteId}/Attachments/${encodeURIComponent(safeOriginalName)}?IncludeOnline=true`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'xero-tenant-id': tenantId,
        'Content-Type': f.mime_type || 'application/octet-stream',
        Accept: 'application/json',
      },
      body: fs.readFileSync(filePath),
    });
    console.log('attachment', safeOriginalName, res.status, await res.text());
  }
}

async function logSync(main, businessId, syncType, referenceId, xeroId, status, detail, xeroState = null) {
  await main.execute(
    'INSERT INTO xero_sync_log (business_id, sync_type, reference_id, xero_id, status, xero_state, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [businessId, syncType, referenceId, xeroId, status, xeroState, detail],
  );
}

async function main() {
  const scnId = 2;
  const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
  const main = await mysql.createConnection(MAIN_DB);
  const ims = await mysql.createConnection(getImsConfig('readyedu_MonsterthreadsIMS'));

  const [scnRows] = await ims.execute(`
    SELECT scn.*, c.name AS supplier_name
    FROM ims_supplier_credit_notes scn
    LEFT JOIN ims_contacts c ON c.id = scn.supplier_id
    WHERE scn.id = ? AND scn.business_id = ?
  `, [scnId, businessId]);
  const scn = scnRows[0];
  if (!scn) throw new Error('SCN not found');

  const [itemRows] = await ims.execute(`
    SELECT * FROM ims_supplier_credit_note_items WHERE scn_id = ?
  `, [scnId]);
  const [acctRows] = await main.execute(
    'SELECT role_key, xero_account_code FROM xero_account_mappings WHERE business_id = ?',
    [businessId],
  );
  const accounts = Object.fromEntries(acctRows.map(r => [r.role_key, r.xero_account_code]));
  const [trackRows] = await main.execute(
    'SELECT ims_location_id, ims_channel, xero_tracking_category_id, xero_tracking_option_id FROM xero_tracking_mappings WHERE business_id = ?',
    [businessId],
  );
  const tracking = trackRows.filter(t => Number(t.ims_location_id) === Number(scn.location_id) && t.ims_channel == null).map(t => ({ TrackingCategoryID: t.xero_tracking_category_id, TrackingOptionID: t.xero_tracking_option_id }));
  const trackingVal = tracking.length ? tracking : undefined;
  const restockAccount = accounts.inventory_asset;
  const nonStockAccount = accounts.supplier_credit_note || accounts.cogs;

  const lineItems = itemRows.map(item => {
    const restock = item.restock === undefined || item.restock === null ? true : !!Number(item.restock);
    const acct = restock ? (restockAccount || nonStockAccount) : (nonStockAccount || restockAccount);
    const taxed = Number(item.tax_rate) > 0 && scn.tax_treatment !== 'no_tax';
    return {
      Description: `${item.code || ''} ${item.name || ''}`.trim() || 'Supplier credit',
      Quantity: Number(item.qty),
      UnitAmount: Number(item.unit_cost),
      AccountCode: acct,
      TaxType: taxed ? 'INPUT' : 'NONE',
      Tracking: trackingVal,
    };
  });

  const base = {
    Type: 'ACCPAY',
    Contact: { Name: scn.supplier_name || `Supplier #${scn.supplier_id}` },
    Date: scn.scn_date,
    CreditNoteNumber: scn.scn_number,
    Reference: scn.supplier_credit_ref || scn.reference || scn.scn_number,
    Status: 'DRAFT',
    LineAmountTypes: scn.tax_treatment === 'inc_tax' ? 'Inclusive' : 'Exclusive',
    LineItems: lineItems,
  };

  console.log('Posting credit note payload:', JSON.stringify(base, null, 2));

  let xeroId = null;
  try {
    const result = await xeroApiFetch(main, businessId, '/CreditNotes', { method: 'POST', body: { CreditNotes: [base] } });
    console.log('Xero create result:', JSON.stringify(result, null, 2));
    xeroId = result.CreditNotes?.[0]?.CreditNoteID || null;
  } catch (err) {
    console.log('Primary error:', err.message);
    const parsed = parseValidation(err.message);
    console.log('Parsed:', parsed);
    if (parsed.duplicateNumber) {
      const fallback = { ...base };
      delete fallback.CreditNoteNumber;
      const result = await xeroApiFetch(main, businessId, '/CreditNotes', { method: 'POST', body: { CreditNotes: [fallback] } });
      console.log('Fallback create result:', JSON.stringify(result, null, 2));
      xeroId = result.CreditNotes?.[0]?.CreditNoteID || null;
    } else {
      throw err;
    }
  }

  if (!xeroId) throw new Error('No Xero CreditNoteID returned');

  await uploadAttachments(main, ims, businessId, scnId, scn.scn_number, xeroId);
  await ims.execute(
    `UPDATE ims_supplier_credit_notes
        SET xero_sync_status = 'synced', xero_synced_at = NOW(), xero_credit_note_id = ?
      WHERE id = ?`,
    [xeroId, scnId],
  );
  await logSync(main, businessId, 'scn_credit_note', scnId, xeroId, 'success', `Manual direct retry succeeded for ${scn.scn_number}`, 'DRAFT');
  console.log('SUCCESS xeroId=', xeroId);

  await ims.end();
  await main.end();
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
