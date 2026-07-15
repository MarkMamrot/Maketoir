const fs = require('fs');
const file = 'src/app/ims/page.tsx';
let c = fs.readFileSync(file, 'utf8');

const old =
  "is blank.{' '}\r\n" +
  "              {showCategories ? 'Category and Subcategory columns are also included. ' : ''}\r\n" +
  "              The columns at the end \u2014{showZoneBin ? ' Zone, Bin,' : ''} Min Qty and Reorder Qty \u2014 are per location and saved against that location\u2019s stock. The default warehouse location appears first.{' '}\r\n" +
  "              <br /><strong>Variant";

const rep =
  "is blank.{' '}\r\n" +
  "              {showCategories ? 'Category and Subcategory columns are also included. ' : ''}\r\n" +
  "              <br /><strong>{showZoneBin ? 'Zone, Bin, Min Qty and Reorder Qty' : 'Min Qty and Reorder Qty'}</strong>{' \u2014 '}per location columns saved against each location\u2019s stock. The default warehouse location appears first.\r\n" +
  "              <br /><strong>Variant";

if (!c.includes(old)) { console.error('NOT FOUND'); process.exit(1); }
c = c.replace(old, rep);
fs.writeFileSync(file, c, 'utf8');
console.log('Done');
