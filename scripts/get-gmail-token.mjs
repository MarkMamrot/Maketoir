/**
 * One-time script to generate a Gmail OAuth refresh token.
 * Uses the existing Desktop OAuth client credentials.
 *
 * Run: node scripts/get-gmail-token.mjs
 *
 * Steps:
 *  1. It prints an auth URL — open it in your browser
 *  2. Sign in with the Gmail account you want to connect
 *  3. Google gives you a code — paste it back into the terminal
 *  4. The script prints your refresh token — copy it to your .env
 */

import * as readline from 'readline';
import * as https from 'https';
import * as querystring from 'querystring';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();

// ── Credentials (from .env / Google Cloud Console) ────────────────────────────
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Desktop apps use this fixed redirect URI
const REDIRECT_URI  = 'urn:ietf:wg:oauth:2.0:oob';

// Scopes — add more here if needed later, e.g. gmail.readonly
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

// ── Build the auth URL ─────────────────────────────────────────────────────────
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id',     CLIENT_ID);
authUrl.searchParams.set('redirect_uri',  REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope',         SCOPES.join(' '));
authUrl.searchParams.set('access_type',   'offline');   // ensures refresh_token is returned
authUrl.searchParams.set('prompt',        'consent');   // forces refresh_token even if previously granted

console.log('\n──────────────────────────────────────────────────────────');
console.log('STEP 1: Open this URL in your browser and sign in with');
console.log('        the Gmail account you want to connect:\n');
console.log(authUrl.toString());
console.log('\n──────────────────────────────────────────────────────────');
console.log('STEP 2: After signing in Google will show you a code.');
console.log('        Paste it below and press Enter.\n');

// ── Read the code from the user ────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste code here: ', async (code) => {
  rl.close();
  code = code.trim();
  if (!code) { console.error('No code entered. Exiting.'); process.exit(1); }

  // ── Exchange the code for tokens ───────────────────────────────────────────
  const postData = querystring.stringify({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    'authorization_code',
  });

  const options = {
    hostname: 'oauth2.googleapis.com',
    path:     '/token',
    method:   'POST',
    headers:  {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const response = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  let tokens;
  try { tokens = JSON.parse(response.body); } catch {
    console.error('Failed to parse response:', response.body);
    process.exit(1);
  }

  if (tokens.error) {
    console.error('\n❌ Error:', tokens.error, tokens.error_description || '');
    process.exit(1);
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('✅ SUCCESS — add these to your .env file:\n');
  console.log(`GOOGLE_GMAIL_CLIENT_ID=${CLIENT_ID}`);
  console.log(`GOOGLE_GMAIL_CLIENT_SECRET=${CLIENT_SECRET}`);
  console.log(`GOOGLE_GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
  if (tokens.access_token) {
    console.log('\n(access_token — only valid for ~1 hour, do not store this):');
    console.log(tokens.access_token.slice(0, 40) + '...');
  }
  console.log('\n──────────────────────────────────────────────────────────\n');
});
