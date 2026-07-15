const fs = require('fs');
const file = 'src/app/api/ims/products/[id]/shopify-sync/route.ts';
let c = fs.readFileSync(file, 'utf8');
const old = "resolveImagePayload(img.url, reqOrigin, cookieHeader, img.alt_text ?? '')";
const rep = "resolveImagePayload(img.url, session.businessId, img.alt_text ?? '')";
const before = (c.split(old).length - 1);
c = c.split(old).join(rep);
fs.writeFileSync(file, c, 'utf8');
console.log('replaced', before, 'occurrences');
