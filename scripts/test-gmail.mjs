/**
 * Quick test — fetches subjects of the 5 most recent emails in the Gmail inbox.
 * Run: node scripts/test-gmail.mjs
 */

import * as https from 'https';
import * as querystring from 'querystring';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

function httpsPost(hostname, path, data) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify(data);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function httpsGet(hostname, path, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.end();
  });
}

// 1. Exchange refresh token for access token
console.log('Getting access token...');
const tokenRes = await httpsPost('oauth2.googleapis.com', '/token', {
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  refresh_token: REFRESH_TOKEN,
  grant_type: 'refresh_token',
});

if (tokenRes.error) {
  console.error('❌ Token error:', tokenRes.error, tokenRes.error_description);
  process.exit(1);
}

const accessToken = tokenRes.access_token;
console.log('✅ Access token obtained\n');

// 2. Fetch list of recent messages
const listRes = await httpsGet(
  'gmail.googleapis.com',
  '/gmail/v1/users/me/messages?maxResults=5',
  accessToken,
);

if (listRes.error) {
  console.error('❌ Gmail list error:', listRes.error);
  process.exit(1);
}

const messages = listRes.messages || [];
if (messages.length === 0) {
  console.log('No messages found.');
  process.exit(0);
}

// 3. Fetch subject for each message
console.log('Recent email subjects:\n');
for (const msg of messages) {
  const detail = await httpsGet(
    'gmail.googleapis.com',
    `/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
    accessToken,
  );
  const headers = detail.payload?.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
  const from    = headers.find(h => h.name === 'From')?.value    || '(unknown sender)';
  console.log(`  Subject: ${subject}`);
  console.log(`  From:    ${from}\n`);
}
