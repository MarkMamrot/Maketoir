#!/usr/bin/env node
/**
 * Inspect Cin7 SalesOrders for branch 3 (Warehouse) to identify which field contains channel info
 * (Shopify/website vs wholesale vs in-person)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import { createDecipheriv } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.dirname(__dirname);

// Load .env file
dotenv.config({ path: path.join(rootDir, '.env') });

/**
 * Decrypt encrypted credentials stored in Google Sheets
 */
function decrypt(stored) {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 3) return stored;
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}

// Load Google Sheets auth
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error('❌ Missing GOOGLE_APPLICATION_CREDENTIALS env var');
  process.exit(1);
}

const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const auth = new google.auth.GoogleAuth({
  keyFile: keyPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

/**
 * Get Cin7 creds from the business database Connections sheet
 */
async function getCin7Credentials(databaseId) {
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: databaseId,
      range: 'Connections',
    });

    const rows = res.data.values || [];
    
    if (rows.length < 2) {
      throw new Error('Connections sheet is empty');
    }

    const headers = rows[0];
    const values = rows[1];

    // Look for Cin7 columns with various naming conventions
    const accIdx = headers.findIndex(h => h && h.toLowerCase().includes('cin7') && h.toLowerCase().includes('account'));
    const apiIdx = headers.findIndex(h => h && h.toLowerCase().includes('cin7') && h.toLowerCase().includes('key'));

    if (accIdx < 0 || apiIdx < 0) {
      throw new Error('Cin7 credentials not found. Looking for Cin7 Account ID and Cin7 API Key');
    }

    const accountId = values[accIdx];
    const encryptedApiKey = values[apiIdx];
    const decryptedApiKey = decrypt(encryptedApiKey);

    console.log('✓ Cin7 AccountId:', accountId);
    console.log('✓ Cin7 ApiKey decrypted successfully\n');

    return {
      accountId,
      apiKey: decryptedApiKey,
    };
  } catch (err) {
    console.error('Error fetching Cin7 credentials:', err.message);
    process.exit(1);
  }
}

/**
 * Get business database ID from Config sheet
 */
async function getDatabaseIdFromConfig() {
  try {
    const masterSheetId = process.env.MASTER_USERS_SHEET_ID;
    if (!masterSheetId) {
      throw new Error('MASTER_USERS_SHEET_ID not set');
    }

    // For now, assume we're using monsterthreads
    // In a real scenario, you'd look this up from Master Users sheet
    // For this investigation, we'll need to pass the databaseId as an arg
    return process.argv[2];
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

/**
 * Fetch SalesOrders for branch 3 with various filters to see range of source values
 */
async function fetchOrdersForBranch3(cin7AccountId, cin7ApiKey) {
  console.log('📦 Fetching SalesOrders for branch 3 (Warehouse)...\n');

  const auth = Buffer.from(`${cin7AccountId}:${cin7ApiKey}`).toString('base64');

  // Try different endpoint variations
  const urls = [
    'https://api.cin7.com/api/v1/SalesOrders?branchId=3&rows=100',
    'https://api.cin7.com/api/v1/SalesOrders?rows=100&where=branchId=3',
    'https://api.cin7.com/api/v1/SalesOrders?rows=100',
  ];

  for (const url of urls) {
    console.log(`\n🔗 Trying: ${url}`);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      });

      console.log(`   Status: ${res.status}`);

      if (!res.ok) {
        const body = await res.text();
        console.log(`   Error: ${res.statusText}`);
        console.log(`   Body: ${body.substring(0, 200)}`);
        continue;
      }

      const data = await res.json();
      console.log(`   Response keys: ${Object.keys(data).join(', ')}`);
      console.log(`   Response: ${JSON.stringify(data).substring(0, 300)}...`);
      
      // Handle different response formats
      let orders = [];
      if (Array.isArray(data)) {
        orders = data;
      } else if (data.Items) {
        orders = data.Items;
      } else if (data.data) {
        orders = data.data;
      } else if (data.SalesOrders) {
        orders = data.SalesOrders;
      }

      console.log(`\n✅ Got ${orders.length} orders\n`);

      if (orders.length > 0) {
        analyzeOrders(orders);
        return;
      }
    } catch (err) {
      console.log(`   Error: ${err.message}`);
    }
  }

  console.log('\n❌ No orders found from any endpoint');
}

function analyzeOrders(orders) {
  // Collect unique source values
  const sources = new Set();
  const channelCandidates = new Map(); // source -> count

  console.log('=== ANALYZING SOURCE FIELD ===\n');

  orders.forEach((order, idx) => {
    const source = order.source;
    if (source) {
      sources.add(source);
      channelCandidates.set(source, (channelCandidates.get(source) || 0) + 1);
    }
  });

  console.log(`📊 Unique "source" values found: ${sources.size}`);
  [...sources].forEach(src => {
    console.log(`   • "${src}" (${channelCandidates.get(src)} orders)`);
  });

  console.log('\n=== SAMPLE ORDERS (first 5) ===\n');
  
  orders.slice(0, 5).forEach((order, idx) => {
    console.log(`\n--- Order ${idx + 1}: ${order.reference} (ID: ${order.id}) ---`);
    console.log(`  branchId:     ${order.branchId}`);
    console.log(`  source:       ${order.source || '(none)'}`);
    console.log(`  status:       ${order.status}`);
    console.log(`  stage:        ${order.stage || '(none)'}`);
    console.log(`  invoiceDate:  ${order.invoiceDate || '(none)'}`);
    
    // Check for custom fields that might indicate channel
    if (order.customFields && Object.keys(order.customFields).length > 0) {
      console.log(`  customFields: ${JSON.stringify(order.customFields)}`);
    }

    // Check for any fields mentioning channel/platform
    const potentialChannelFields = ['source', 'channel', 'platform', 'origin', 'salesChannel', 'saleChannel', 'integration'];
    const matchedFields = Object.keys(order).filter(k => 
      potentialChannelFields.some(pf => k.toLowerCase().includes(pf.toLowerCase()))
    );
    if (matchedFields.length > 0) {
      console.log(`  🔍 Potential channel fields: ${matchedFields.map(f => `${f}="${order[f]}"`).join(', ')}`);
    }
  });

  console.log('\n\n=== TOP-LEVEL FIELD SUMMARY (from first order) ===\n');
  if (orders.length > 0) {
    const firstOrder = orders[0];
    const fields = Object.keys(firstOrder).sort();
    console.log(`Total top-level fields: ${fields.length}\n`);
    console.log('Fields that might indicate channel/source:');
    fields.forEach(f => {
      const val = firstOrder[f];
      if (f.toLowerCase().includes('source') || f.toLowerCase().includes('channel') || 
          f.toLowerCase().includes('platform') || f.toLowerCase().includes('origin') ||
          f.toLowerCase().includes('integration')) {
        console.log(`  ✓ ${f}: ${JSON.stringify(val).substring(0, 60)}`);
      }
    });
  }
}

// Main
(async () => {
  const databaseId = await getDatabaseIdFromConfig();
  if (!databaseId) {
    console.error('Usage: node inspect-sales-channels.mjs <database-id>');
    process.exit(1);
  }

  const { accountId, apiKey } = await getCin7Credentials(databaseId);
  await fetchOrdersForBranch3(accountId, apiKey);
})();
