/**
 * railway-cutover.mjs
 *
 * Final step: swaps the active MYSQL_* env vars to point at Railway.
 * Updates .env so local dev also uses Railway.
 *
 * After running this, restart the dev server (`npm run dev`).
 * Also update Railway's own environment variables:
 *   MYSQL_HOST     = mysql.railway.internal
 *   MYSQL_PORT     = 3306
 *   MYSQL_USER     = root
 *   MYSQL_PASSWORD = <your Railway password>
 *   (internal hostname for zero-latency inside Railway network)
 *
 * Usage:  node scripts/railway-cutover.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import 'dotenv/config';

const envPath = resolve(process.cwd(), '.env');
let env = readFileSync(envPath, 'utf-8');

const e = process.env;

// Swap old values for new Railway values
const replacements = [
  ['MYSQL_HOST',     e.MYSQL_HOST,          e.NEW_MYSQL_HOST],
  ['MYSQL_PORT',     String(e.MYSQL_PORT),  String(e.NEW_MYSQL_PORT)],
  ['MYSQL_USER',     e.MYSQL_USER,          e.NEW_MYSQL_USER],
  ['MYSQL_PASSWORD', e.MYSQL_PASSWORD,      e.NEW_MYSQL_PASSWORD?.replace(/^"|"$/g, '')],
];

for (const [key, oldVal, newVal] of replacements) {
  if (!oldVal || !newVal) { console.warn(`Skipping ${key} — value missing`); continue; }
  const oldLine = new RegExp(`^(${key}=).*$`, 'm');
  env = env.replace(oldLine, `$1${newVal}`);
  console.log(`  ${key}: ${oldVal} → ${newVal}`);
}

writeFileSync(envPath, env, 'utf-8');
console.log('\n✅  .env updated to use Railway database.');
console.log('   Restart dev server: npm run dev');
console.log('   Also update MYSQL_HOST in Railway env vars to: mysql.railway.internal');
console.log('   and MYSQL_PORT to: 3306  (internal port, not the proxy port)');
