import { readFileSync, writeFileSync } from 'fs';

const path = 'src/app/api/sync/marketing/route.ts';
let c = readFileSync(path, 'utf8');

// 1. Add imports after 'import { decrypt }...'
const decryptImport = "import { decrypt } from '@/lib/encryption';";
if (!c.includes("from '@/lib/db/ConnectionsRepository'")) {
  c = c.replace(
    decryptImport,
    decryptImport +
      "\r\nimport { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';" +
      "\r\nimport { ConfigRepository } from '@/lib/db/ConfigRepository';"
  );
  console.log('Added imports');
} else {
  console.log('Imports already present');
}

// 2. Remove SECRET_CONN_FIELDS constant + all helper functions up to errorMessage
const helperStart = c.indexOf('\r\nconst SECRET_CONN_FIELDS');
const helperEnd   = c.indexOf('/** Extract a readable message from any error shape');
if (helperStart >= 0 && helperEnd >= 0) {
  c = c.slice(0, helperStart) + '\r\n' + c.slice(helperEnd);
  console.log('Removed helper functions block');
} else {
  console.log('Helper block not found (start=' + helperStart + ', end=' + helperEnd + ')');
}

writeFileSync(path, c, 'utf8');
console.log('Done.');
