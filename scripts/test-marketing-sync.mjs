/**
 * Diagnostic script for the /api/sync/marketing route.
 * Tests Google Ads + Meta connections and their first queries.
 *
 * Run: node scripts/test-marketing-sync.mjs
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { GoogleAdsApi } from 'google-ads-api';
import { createDecipheriv } from 'crypto';

// ── Decrypt helper (mirrors src/lib/encryption.ts) ────────────────────────────
function decrypt(stored) {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 3) return stored; // not encrypted
  const [ivHex, authTagHex, encHex] = parts;
  if (ivHex.length !== 24 || authTagHex.length !== 32) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

// This is the business database (Monsterthreads), which has the Connections tab.
// 1N73YkEOwusJfq9X4LvNRLDni8CmhHVPj16JxzxO2Dd4 is the Marketing Data output sheet.
const DATABASE_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

// ── Sheets auth ───────────────────────────────────────────────────────────────
const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8')
  : null;
const credentials = credRaw ? JSON.parse(credRaw) : undefined;
const auth = new google.auth.GoogleAuth({
  credentials,
  keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

// ── Read Connections tab ──────────────────────────────────────────────────────
console.log('\n=== Reading Connections tab ===');
const connRes = await sheets.spreadsheets.values.get({
  spreadsheetId: DATABASE_ID,
  range: 'Connections!A1:Z2',
});
const connRows = connRes.data.values ?? [];
const headers = connRows[0] ?? [];
const values  = connRows[1] ?? [];
const conn = {};
for (let i = 0; i < headers.length; i++) conn[headers[i]] = values[i] ?? '';

console.log('Fields found:', headers.join(', '));
console.log('GoogleAdsCustomerId:', conn.GoogleAdsCustomerId || '(empty)');
console.log('MetaAdAccountId:    ', conn.MetaAdAccountId    || '(empty)');
console.log('MetaAccessToken:    ', conn.MetaAccessToken ? conn.MetaAccessToken.slice(0, 20) + '…' : '(empty)');

// ── Test Google Ads ───────────────────────────────────────────────────────────
console.log('\n=== Testing Google Ads ===');

const gadsEnvVars = {
  GOOGLE_ADS_CLIENT_ID:      process.env.GOOGLE_ADS_CLIENT_ID,
  GOOGLE_ADS_CLIENT_SECRET:  process.env.GOOGLE_ADS_CLIENT_SECRET,
  GOOGLE_ADS_DEVELOPER_TOKEN:process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_ADS_REFRESH_TOKEN:  process.env.GOOGLE_ADS_REFRESH_TOKEN,
  GOOGLE_ADS_CUSTOMER_ID:    process.env.GOOGLE_ADS_CUSTOMER_ID,
};
for (const [k, v] of Object.entries(gadsEnvVars)) {
  console.log(`  ${k}: ${v ? (k.includes('TOKEN') || k.includes('SECRET') ? v.slice(0,20)+'…' : v) : '(MISSING)'}`);
}

const customerId = (conn.GoogleAdsCustomerId || process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
if (!customerId) {
  console.log('  ✕ No customer ID — skipping Google Ads test');
} else {
  console.log(`  Using customer ID: ${customerId}`);
  try {
    const client = new GoogleAdsApi({
      client_id:       process.env.GOOGLE_ADS_CLIENT_ID     || '',
      client_secret:   process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    });
    const customer = client.Customer({
      customer_id:   customerId,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
    });

    // Minimal Campaigns query (no impression share to avoid type conflicts)
    const today = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const rows = await customer.query(`
      SELECT
        campaign.id, campaign.name, campaign.status,
        metrics.impressions, metrics.clicks, metrics.cost_micros
      FROM campaign
      WHERE segments.date BETWEEN '${start}' AND '${today}'
        AND campaign.status != 'REMOVED'
    `);
    console.log(`  ✓ Campaigns query OK — ${rows.length} rows returned`);
    if (rows.length) console.log('  Sample:', JSON.stringify(rows[0]).slice(0, 200));
  } catch (e) {
    console.log('  ✕ Campaigns query FAILED');
    console.log('  Error type:', e?.constructor?.name);
    console.log('  e.message:', e?.message);
    console.log('  e.errors:', JSON.stringify(e?.errors ?? e?.details ?? '—').slice(0, 500));
    console.log('  Full error:', JSON.stringify(e, null, 2).slice(0, 1000));
  }

  // Auction Insights (Competitors) — try both approaches
  try {
    const client2 = new GoogleAdsApi({ client_id: process.env.GOOGLE_ADS_CLIENT_ID||'', client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET||'', developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN||'' });
    const customer2 = client2.Customer({ customer_id: customerId, refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN||'' });
    const rows2 = await customer2.query(`
      SELECT
        campaign.name,
        segments.auction_insight.domain,
        metrics.search_impression_share,
        metrics.search_overlap_rate,
        metrics.search_outranking_share
      FROM auction_insight
    `);
    console.log(`  ✓ Auction Insights (segments.auction_insight.domain) — ${rows2.length} rows`);
  } catch (e) {
    console.log('  ✕ segments.auction_insight.domain FAILED:', e?.errors?.[0]?.message ?? e?.message ?? JSON.stringify(e).slice(0,200));
    // Fallback: try from campaign with auction_insight metrics (no competitor domains)
    try {
      const client3 = new GoogleAdsApi({ client_id: process.env.GOOGLE_ADS_CLIENT_ID||'', client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET||'', developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN||'' });
      const customer3 = client3.Customer({ customer_id: customerId, refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN||'' });
      const today = new Date().toISOString().split('T')[0];
      const start = new Date(Date.now() - 90*86400000).toISOString().split('T')[0];
      const rows3 = await customer3.query(`
        SELECT
          campaign.name,
          metrics.auction_insight_search_impression_share,
          metrics.auction_insight_search_outranking_share,
          metrics.auction_insight_search_overlap_rate,
          metrics.auction_insight_search_top_impression_percentage,
          metrics.auction_insight_search_absolute_top_impression_percentage
        FROM campaign
        WHERE segments.date BETWEEN '${start}' AND '${today}'
          AND campaign.status != 'REMOVED'
      `);
      console.log(`  ✓ Auction Insights fallback (from campaign, no domains) — ${rows3.length} rows`);
    } catch (e2) {
      console.log('  ✕ Auction Insights fallback FAILED:', e2?.errors?.[0]?.message ?? e2?.message);
    }
  }
}

// ── Test Meta ─────────────────────────────────────────────────────────────────
console.log('\n=== Testing Meta Ads ===');

const metaAccountId = conn.MetaAdAccountId || '';
const metaToken     = conn.MetaAccessToken ? decrypt(conn.MetaAccessToken) : '';

if (!metaAccountId || !metaToken) {
  console.log('  ✕ MetaAdAccountId or MetaAccessToken is empty in Connections tab — cannot test');
} else {
  const id = metaAccountId.startsWith('act_') ? metaAccountId : `act_${metaAccountId}`;
  // Simple token validation call first
  try {
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${encodeURIComponent(metaToken)}`);
    const me = await meRes.json();
    if (me.error) {
      console.log('  ✕ Token validation failed:', me.error.message);
    } else {
      console.log(`  ✓ Token valid — user: ${me.name} (${me.id})`);
    }
  } catch (e) {
    console.log('  ✕ Token validation request failed:', e.message);
  }

  // Campaign-level insights
  try {
    const url = new URL(`https://graph.facebook.com/v19.0/${id}/insights`);
    url.searchParams.set('level', 'campaign');
    url.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks');
    url.searchParams.set('date_preset', 'last_7d');
    url.searchParams.set('limit', '5');
    url.searchParams.set('access_token', metaToken);

    const res = await fetch(url.toString());
    const json = await res.json();
    if (json.error) {
      console.log('  ✕ Campaign insights failed:', json.error.message);
      console.log('  Error code:', json.error.code, '| Type:', json.error.type);
    } else {
      console.log(`  ✓ Campaign insights OK — ${json.data?.length ?? 0} rows`);
      if (json.data?.length) console.log('  Sample:', JSON.stringify(json.data[0]).slice(0, 200));
    }
  } catch (e) {
    console.log('  ✕ Campaign insights request failed:', e.message);
  }
}

console.log('\n=== Done ===\n');
