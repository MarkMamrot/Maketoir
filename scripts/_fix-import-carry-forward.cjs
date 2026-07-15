// One-shot script — run with: node scripts/_fix-import-carry-forward.cjs
const fs = require('fs');
const file = 'src/app/ims/page.tsx';
let c = fs.readFileSync(file, 'utf8');

const old =
  "foundUnknownBrands = new Set<string>();\r\n" +
  "    const foundUnknownSuppliers = new Set<string>();\r\n" +
  "\r\n" +
  "    const rows: ParsedImportRow[] = dataLines.map(line => {\r\n" +
  "      const cells = line.split('\\t');\r\n" +
  "      const raw: Record<string, string> = {};\r\n" +
  "      headers.forEach((h, i) => { raw[h] = (cells[i] ?? '').trim(); });\r\n" +
  "\r\n" +
  "      const product_name = raw['product_name'] || '';\r\n" +
  "      const sku = raw['sku'] || '';\r\n" +
  "      const product_sku = raw['product_sku'] || ''; // Product_SKU grouping key\r\n" +
  "      const brand = raw['brand'] || '';\r\n" +
  "      const supplier = raw['supplier'] || '';\r\n" +
  "\r\n" +
  "      if (!product_name && !sku) {\r\n" +
  "        return { raw, product_name, sku, action: 'error' as const, errorMsg: 'Missing Product_Name and SKU' };\r\n" +
  "      }";

const rep =
  "foundUnknownBrands = new Set<string>();\r\n" +
  "    const foundUnknownSuppliers = new Set<string>();\r\n" +
  "\r\n" +
  "    // Pre-pass: cache product-level fields from the first row of each Product_SKU group so\r\n" +
  "    // subsequent variant rows can omit Product_Name, Brand, Supplier, Description etc.\r\n" +
  "    const batchProductFields = new Map<string, Record<string, string>>();\r\n" +
  "    for (const dline of dataLines) {\r\n" +
  "      const dcells = dline.split('\\t');\r\n" +
  "      const draw: Record<string, string> = {};\r\n" +
  "      headers.forEach((h, i) => { draw[h] = (dcells[i] ?? '').trim(); });\r\n" +
  "      const dps = normStr(draw['product_sku'] || '');\r\n" +
  "      if (dps && !batchProductFields.has(dps) && (draw['product_name'] || '').trim()) {\r\n" +
  "        batchProductFields.set(dps, draw);\r\n" +
  "      }\r\n" +
  "    }\r\n" +
  "\r\n" +
  "    const rows: ParsedImportRow[] = dataLines.map(line => {\r\n" +
  "      const cells = line.split('\\t');\r\n" +
  "      const raw: Record<string, string> = {};\r\n" +
  "      headers.forEach((h, i) => { raw[h] = (cells[i] ?? '').trim(); });\r\n" +
  "\r\n" +
  "      const product_sku = raw['product_sku'] || ''; // Product_SKU grouping key\r\n" +
  "\r\n" +
  "      // Inherit missing product-level fields from the first row with the same Product_SKU\r\n" +
  "      const cached = product_sku ? batchProductFields.get(normStr(product_sku)) : undefined;\r\n" +
  "      if (cached) {\r\n" +
  "        for (const field of ['product_name','description','product_type','brand','supplier','tags','category','subcategory']) {\r\n" +
  "          if (!raw[field] && cached[field]) raw[field] = cached[field];\r\n" +
  "        }\r\n" +
  "      }\r\n" +
  "\r\n" +
  "      const product_name = raw['product_name'] || '';\r\n" +
  "      const sku = raw['sku'] || '';\r\n" +
  "      const brand = raw['brand'] || '';\r\n" +
  "      const supplier = raw['supplier'] || '';\r\n" +
  "\r\n" +
  "      if (!product_name && !sku) {\r\n" +
  "        return { raw, product_name, sku, action: 'error' as const, errorMsg: 'Missing Product_Name and SKU' };\r\n" +
  "      }";

if (!c.includes(old)) {
  console.error('OLD STRING NOT FOUND - aborting');
  process.exit(1);
}
c = c.replace(old, rep);
fs.writeFileSync(file, c, 'utf8');
console.log('Done - carry-forward logic added');
