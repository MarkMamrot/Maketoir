// node scripts/_fix-pricing-per-variant.cjs
const fs = require('fs');
const file = 'src/app/ims/page.tsx';
let c = fs.readFileSync(file, 'utf8');

// ── Change 1: Replace standalone Pricing section with a "Set all variants" helper ──
const oldPricing =
  '          {/* \u2500\u2500 Pricing \u2500\u2500 */}\r\n' +
  '          <div style={{ display: \'flex\', alignItems: \'center\', gap: 10, marginBottom: 14 }}>\r\n' +
  '            <div style={{ flex: 1, height: 1, background: \'var(--sv-etch)\' }} />\r\n' +
  '            <span style={{ fontSize: 11, fontWeight: 700, color: \'var(--sv-text-dim)\', textTransform: \'uppercase\', letterSpacing: .8 }}>Pricing</span>\r\n' +
  '            <div style={{ flex: 1, height: 1, background: \'var(--sv-etch)\' }} />\r\n' +
  '          </div>\r\n' +
  '          <div style={{ display: \'flex\', gap: 12, flexWrap: \'wrap\', marginBottom: 20 }}>\r\n' +
  '            <Field label="Price (RRP) $"><input type="number" step="0.01" min="0" value={productPrices.price_rrp} onChange={e => updateProductPrice(\'price_rrp\', e.target.value)} style={{ ...inputStyle, width: 100 }} placeholder="0.00" /></Field>\r\n' +
  '            <Field label="Wholesale $"><input type="number" step="0.01" min="0" value={productPrices.price_wholesale} onChange={e => updateProductPrice(\'price_wholesale\', e.target.value)} style={{ ...inputStyle, width: 100 }} placeholder="\u2014" /></Field>\r\n' +
  '            <Field label="Disc. Price $"><input type="number" step="0.01" min="0" value={productPrices.price_rrp_sale} onChange={e => updateProductPrice(\'price_rrp_sale\', e.target.value)} style={{ ...inputStyle, width: 100 }} placeholder="\u2014" /></Field>\r\n' +
  '            <Field label="Disc. From"><input type="date" value={productPrices.discount_start_date} onChange={e => updateProductPrice(\'discount_start_date\', e.target.value)} style={{ ...inputStyle, width: 140 }} /></Field>\r\n' +
  '            <Field label="Disc. To"><input type="date" value={productPrices.discount_end_date} onChange={e => updateProductPrice(\'discount_end_date\', e.target.value)} style={{ ...inputStyle, width: 140 }} /></Field>\r\n' +
  '          </div>';

const newPricing =
  '          {/* \u2500\u2500 Pricing (set-all helper) \u2500\u2500 */}\r\n' +
  '          <div style={{ display: \'flex\', alignItems: \'center\', gap: 10, marginBottom: 8 }}>\r\n' +
  '            <div style={{ flex: 1, height: 1, background: \'var(--sv-etch)\' }} />\r\n' +
  '            <span style={{ fontSize: 11, fontWeight: 700, color: \'var(--sv-text-dim)\', textTransform: \'uppercase\', letterSpacing: .8 }}>Pricing</span>\r\n' +
  '            <div style={{ flex: 1, height: 1, background: \'var(--sv-etch)\' }} />\r\n' +
  '          </div>\r\n' +
  '          <div style={{ display: \'flex\', gap: 10, flexWrap: \'wrap\', alignItems: \'flex-end\', marginBottom: 16, padding: \'10px 12px\', background: \'var(--sv-bg-2)\', borderRadius: 8, border: \'1px solid var(--sv-etch)\' }}>\r\n' +
  '            <span style={{ fontSize: 11, color: \'var(--sv-text-dim)\', whiteSpace: \'nowrap\', alignSelf: \'center\' }}>Set all variants:</span>\r\n' +
  '            <Field label="RRP $"><input type="number" step="0.01" min="0" value={productPrices.price_rrp} onChange={e => updateProductPrice(\'price_rrp\', e.target.value)} style={{ ...inputStyle, width: 88, marginBottom: 0 }} placeholder="0.00" /></Field>\r\n' +
  '            <Field label="Wholesale $"><input type="number" step="0.01" min="0" value={productPrices.price_wholesale} onChange={e => updateProductPrice(\'price_wholesale\', e.target.value)} style={{ ...inputStyle, width: 88, marginBottom: 0 }} placeholder="" /></Field>\r\n' +
  '            <Field label="Sale $"><input type="number" step="0.01" min="0" value={productPrices.price_rrp_sale} onChange={e => updateProductPrice(\'price_rrp_sale\', e.target.value)} style={{ ...inputStyle, width: 88, marginBottom: 0 }} placeholder="" /></Field>\r\n' +
  '            <Field label="Sale From"><input type="date" value={productPrices.discount_start_date} onChange={e => updateProductPrice(\'discount_start_date\', e.target.value)} style={{ ...inputStyle, width: 130, marginBottom: 0 }} /></Field>\r\n' +
  '            <Field label="Sale To"><input type="date" value={productPrices.discount_end_date} onChange={e => updateProductPrice(\'discount_end_date\', e.target.value)} style={{ ...inputStyle, width: 130, marginBottom: 0 }} /></Field>\r\n' +
  '          </div>';

if (!c.includes(oldPricing)) { console.error('PRICING SECTION NOT FOUND'); process.exit(1); }
c = c.replace(oldPricing, newPricing);
console.log('Change 1: pricing section converted to set-all helper');

// ── Change 2: Extend variant table header ──────────────────────────────────
const oldHeader =
  "                    {'Variant','SKU','Barcode','Cost $','Wt kg',\r\n" +
  "                      ...activeCurrencies.map(c => c),\r\n" +
  "                      '\u2713',''].map";

const newHeader =
  "                    {'Variant','SKU','Barcode','RRP $','Wholesale $','Sale $','Sale From','Sale To','Cost $','Wt kg',\r\n" +
  "                      ...activeCurrencies.map(c => c),\r\n" +
  "                      '\u2713',''].map";

if (!c.includes(oldHeader)) { console.error('TABLE HEADER NOT FOUND'); process.exit(1); }
c = c.replace(oldHeader, newHeader);
console.log('Change 2: table header extended with price columns');

// ── Change 3: Add price cells to each variant row ─────────────────────────
const oldCells =
  "                        <td style={{ padding: '2px 4px', minWidth: 80 }}><input value={row.sku} onChange={e => updateRow(row._tempId, 'sku', e.target.value)} style={cellInput} /></td>\r\n" +
  "                        <td style={{ padding: '2px 4px', minWidth: 90 }}><input value={row.barcode} onChange={e => updateRow(row._tempId, 'barcode', e.target.value)} style={cellInput} /></td>\r\n" +
  "                        <td style={{ padding: '2px 4px', minWidth: 72 }}><input type=\"number\" step=\"0.0001\" min=\"0\" value={row.cost_aud} onChange={e => updateRow(row._tempId, 'cost_aud', e.target.value)} style={cellInput} /></td>";

const newCells =
  "                        <td style={{ padding: '2px 4px', minWidth: 80 }}><input value={row.sku} onChange={e => updateRow(row._tempId, 'sku', e.target.value)} style={cellInput} /></td>\r\n" +
  "                        <td style={{ padding: '2px 4px', minWidth: 90 }}><input value={row.barcode} onChange={e => updateRow(row._tempId, 'barcode', e.target.value)} style={cellInput} /></td>\r\n" +
  "                        <td style={{ padding: '2px 4px', minWidth: 72 }}><input type=\"number\" step=\"0.01\" min=\"0\" value={row.price_rrp} onChange={e => updateRow(row._tempId, 'price_rrp', e.target.value)} style={cellInput} placeholder=\"0.00\" /></td>\r\n" +
  "                        <td style={{ padding: '2px 4px', minWidth: 80 }}><input type=\"number\" step=\"0.01\" min=\"0\" value={row.price_wholesale} onChange={e => updateRow(row._tempId, 'price_wholesale', e.target.value)} style={cellInput} /></td>\r\n" +
  "                        <td style={{ padding: '2px 4px', minWidth: 72 }}><input type=\"number\" step=\"0.01\" min=\"0\" value={row.price_rrp_sale} onChange={e => updateRow(row._tempId, 'price_rrp_sale', e.target.value)} style={cellInput} /></td>\r\n" +
  "                        <td style={{ padding: '2px 4px', minWidth: 108 }}><input type=\"date\" value={row.discount_start_date} onChange={e => updateRow(row._tempId, 'discount_start_date', e.target.value)} style={cellInput} /></td>\r\n" +
  "                        <td style={{ padding: '2px 4px', minWidth: 108 }}><input type=\"date\" value={row.discount_end_date} onChange={e => updateRow(row._tempId, 'discount_end_date', e.target.value)} style={cellInput} /></td>\r\n" +
  "                        <td style={{ padding: '2px 4px', minWidth: 72 }}><input type=\"number\" step=\"0.0001\" min=\"0\" value={row.cost_aud} onChange={e => updateRow(row._tempId, 'cost_aud', e.target.value)} style={cellInput} /></td>";

if (!c.includes(oldCells)) { console.error('TABLE CELLS NOT FOUND'); process.exit(1); }
c = c.replace(oldCells, newCells);
console.log('Change 3: per-variant price cells added to table rows');

fs.writeFileSync(file, c, 'utf8');
console.log('All done');
