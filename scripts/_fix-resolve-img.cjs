const fs = require('fs');
const file = 'src/app/api/ims/products/[id]/shopify-sync/route.ts';
let c = fs.readFileSync(file, 'utf8');
const old = "resolveImagePayload(img.url, session.businessId, img.alt_text ?? '')";
const rep = "resolveImagePayload(img, session.businessId)";
const n = c.split(old).length - 1;
c = c.split(old).join(rep);
// function is now sync - remove any await
c = c.split('= await resolveImagePayload(').join('= resolveImagePayload(');
fs.writeFileSync(file, c, 'utf8');
console.log('replaced', n, 'call sites');
