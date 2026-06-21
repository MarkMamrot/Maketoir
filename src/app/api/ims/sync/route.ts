import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { getCin7Credentials, cin7FetchAllPages, cin7ForEachPage } from '@/lib/cin7Helpers';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

async function getImsSetting(businessId: string, key: string): Promise<string | null> {
  const rows = await imsQuery<{ value: string }>(
    'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ?',
    [businessId, key],
  );
  return rows[0]?.value ?? null;
}

async function setImsSetting(businessId: string, key: string, value: string): Promise<void> {
  await imsExecute(
    'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [businessId, key, value],
  );
}

async function runMigrations(): Promise<void> {
  const migrations = [
    'ALTER TABLE ims_products ADD COLUMN IF NOT EXISTS pack_size INT NULL',
    'ALTER TABLE ims_products ADD COLUMN IF NOT EXISTS zone VARCHAR(50) NULL',
    'ALTER TABLE ims_products ADD COLUMN IF NOT EXISTS bin VARCHAR(50) NULL',
    `CREATE TABLE IF NOT EXISTS ims_sales_history (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      cin7_order_id VARCHAR(100) NOT NULL,
      variant_id VARCHAR(100) NULL,
      cin7_option_id INT NULL,
      sku VARCHAR(100) NULL,
      product_name VARCHAR(255) NULL,
      branch_id INT NULL,
      invoice_date DATE NULL,
      qty DECIMAL(10,4) DEFAULT 0,
      unit_price DECIMAL(12,4) DEFAULT 0,
      line_total DECIMAL(12,4) DEFAULT 0,
      amount_due DECIMAL(12,4) NULL,
      source VARCHAR(100) NULL,
      INDEX idx_variant_id (variant_id),
      INDEX idx_invoice_date (invoice_date),
      INDEX idx_cin7_order_id (cin7_order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    'ALTER TABLE ims_sales_history ADD COLUMN IF NOT EXISTS amount_due DECIMAL(12,4) NULL',
    'ALTER TABLE ims_contacts ADD COLUMN IF NOT EXISTS cin7_customer_id INT NULL',
    'ALTER TABLE ims_sales_history ADD COLUMN IF NOT EXISTS reference VARCHAR(100) NULL',
    'ALTER TABLE ims_sales_history ADD COLUMN IF NOT EXISTS stage VARCHAR(100) NULL',
    'ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS cin7_order_id VARCHAR(100) NULL',
    'ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS is_historical TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS cin7_order_id VARCHAR(100) NULL',
    'ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS is_historical TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS currency_code VARCHAR(10) NOT NULL DEFAULT \'AUD\'',
    'ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,6) NOT NULL DEFAULT 1.000000',
    'ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS currency_code VARCHAR(10) NOT NULL DEFAULT \'AUD\'',
    'ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,6) NOT NULL DEFAULT 1.000000',
    'ALTER TABLE ims_purchase_order_items MODIFY COLUMN variant_id VARCHAR(36) NULL',
    'ALTER TABLE ims_sales_order_items MODIFY COLUMN variant_id VARCHAR(36) NULL',
    'ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100) NULL',
    'ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100) NULL',
    'ALTER TABLE ims_purchase_orders MODIFY COLUMN payment_terms VARCHAR(100) NULL',
    'ALTER TABLE ims_sales_orders MODIFY COLUMN payment_terms VARCHAR(100) NULL',
    "ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS so_type VARCHAR(10) NOT NULL DEFAULT 'b2b'",
    `CREATE TABLE IF NOT EXISTS ims_purchase_order_payments (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      po_id         INT NOT NULL,
      payment_date  DATE NOT NULL,
      amount        DECIMAL(12,4) NOT NULL,
      currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD',
      exchange_rate DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
      amount_local  DECIMAL(12,4) NOT NULL,
      notes         VARCHAR(500),
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (po_id) REFERENCES ims_purchase_orders(id) ON DELETE CASCADE,
      INDEX idx_pop_po (po_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS ims_sales_order_payments (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      so_id         INT NOT NULL,
      payment_date  DATE NOT NULL,
      amount        DECIMAL(12,4) NOT NULL,
      currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD',
      exchange_rate DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
      amount_local  DECIMAL(12,4) NOT NULL,
      notes         VARCHAR(500),
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (so_id) REFERENCES ims_sales_orders(id) ON DELETE CASCADE,
      INDEX idx_sop_so (so_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    // Extend ENUMs for POS stock movements
    `ALTER TABLE ims_stock_movements MODIFY COLUMN movement_type ENUM('po_approved','po_unapproved','po_received','so_confirmed','so_unconfirmed','so_fulfilled','adjustment','transfer_in','transfer_out','pos_sale') NOT NULL`,
    `ALTER TABLE ims_stock_movements MODIFY COLUMN reference_type ENUM('purchase_order','sales_order','manual','pos_sale') NOT NULL`,
    // Store raw Cin7 contact IDs for reliable re-linking after contacts sync
    'ALTER TABLE ims_sales_orders ADD COLUMN IF NOT EXISTS cin7_member_id INT NULL',
    'ALTER TABLE ims_purchase_orders ADD COLUMN IF NOT EXISTS cin7_contact_id INT NULL',
  ];
  for (const sql of migrations) {
    try { await imsExecute(sql, []); } catch { /* already applied */ }
  }
}

type SOStatus = 'draft' | 'confirmed' | 'fulfilled' | 'cancelled';
type POStatus = 'draft' | 'approved' | 'received' | 'cancelled';

function cinSoStageToIms(stage: string, cin7Status?: string): { status: SOStatus; isHistorical: number } {
  const apiStatus = (cin7Status ?? '').toUpperCase();
  if (apiStatus === 'VOID') return { status: 'cancelled', isHistorical: 1 };
  const s = (stage ?? '').toLowerCase().replace(/\s+/g, '');
  if (/^draft/.test(s)) return { status: 'draft', isHistorical: 0 };
  if (/void|cancel/.test(s)) return { status: 'cancelled', isHistorical: 1 };
  if (/complete|fulfilled|invoiced|delivered|shipped|dispatched/.test(s)) return { status: 'fulfilled', isHistorical: 1 };
  return { status: 'confirmed', isHistorical: 0 };
}

function cinPoStageToIms(stage: string): { status: POStatus; isHistorical: number } {
  const s = (stage ?? '').toLowerCase().trim();
  if (/^draft/.test(s)) return { status: 'draft', isHistorical: 0 };
  if (/void|cancel/.test(s)) return { status: 'cancelled', isHistorical: 1 };
  if (/\breceived\b|\bcomplete\b/.test(s)) return { status: 'received', isHistorical: 1 };
  return { status: 'approved', isHistorical: 0 };
}

async function getOrCreateUnknownLoc(): Promise<number> {
  const rows = await imsQuery<{ id: number }>(
    "SELECT id FROM ims_locations WHERE code = '__unknown__' LIMIT 1", [],
  );
  if (rows.length > 0) return rows[0].id;
  const r = await imsExecute(
    "INSERT INTO ims_locations (name, code, is_active) VALUES ('Unknown (Cin7)', '__unknown__', 0)", [],
  );
  return r.insertId;
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const businessId: string = session.businessId;
  if (!businessId) {
    return new Response(JSON.stringify({ error: 'No business ID in session' }), { status: 400 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* no body is fine */ }

  const syncType: 'full' | 'latest' = body.sync_type === 'full' ? 'full' : 'latest';
  const salesMonths: number = Math.min(Math.max(Number(body.sales_months) || 6, 1), 120);
  const poMonths: number = Math.min(Math.max(Number(body.po_months) || 60, 1), 240);
  const stepsRequested: string[] = Array.isArray(body.steps)
    ? body.steps
    : ['locations', 'contacts', 'products', 'stock', 'sales'];

  let creds: Awaited<ReturnType<typeof getCin7Credentials>>;
  try {
    creds = await getCin7Credentials(businessId);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        await runMigrations();

        const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

        // -- Step A: Locations from Cin7 /Branches --------------------------
        if (stepsRequested.includes('locations')) {
          send({ step: 'locations', status: 'running', message: 'Fetching branches from Cin7...' });

          const cin7Branches = await cin7FetchAllPages(creds.authHeader, '/Branches', {}, 'ims/branches');

          const existingLocs = await imsQuery<{ id: number; name: string }>(
            'SELECT id, name FROM ims_locations',
          );
          const locMap = new Map<string, number>(existingLocs.map(r => [r.name, r.id]));

          let locNew = 0;
          for (const b of cin7Branches) {
            const name = (b.name ?? b.branchName ?? '').trim();
            const cin7Id = b.id ?? b.branchId;
            const isActive = (b.isActive !== false && b.isActive !== 0) ? 1 : 0;
            if (!name || cin7Id == null) continue;

            if (!locMap.has(name)) {
              const res = await imsExecute(
                'INSERT INTO ims_locations (name, code, is_active, cin7_branch_id) VALUES (?, ?, ?, ?)',
                [name, String(cin7Id), isActive, cin7Id],
              );
              locMap.set(name, res.insertId);
              locNew++;
            } else {
              await imsExecute(
                'UPDATE ims_locations SET cin7_branch_id = ?, is_active = ? WHERE name = ?',
                [cin7Id, isActive, name],
              );
            }
          }
          send({ step: 'locations', status: 'done', count: locNew, message: `${locNew} new, ${cin7Branches.length} total from Cin7` });
        }

        // -- Step B: Contacts from Cin7 /Contacts ---------------------------
        if (stepsRequested.includes('contacts')) {
          send({ step: 'contacts', status: 'running', message: 'Fetching contacts from Cin7...' });

          const cin7Contacts = await cin7FetchAllPages(creds.authHeader, '/Contacts', {}, 'ims/contacts');
          const suppliers = cin7Contacts.filter((c: any) =>
            c.type === 'Supplier' || c.type === 'Both' || c.isSupplier === true || (c.isSupplier && !c.isCustomer),
          );

          const existing = await imsQuery<{ id: number; cin7_supplier_id: number | null }>(
            'SELECT id, cin7_supplier_id FROM ims_contacts WHERE cin7_supplier_id IS NOT NULL',
          );
          const contactByCin7 = new Map<number, number>(existing.map(r => [r.cin7_supplier_id!, r.id]));

          let contactNew = 0;
          for (const c of suppliers) {
            const cin7Id = Number(c.id ?? c.contactId);
            if (!cin7Id || isNaN(cin7Id)) continue;
            const company = (c.company ?? c.companyName ?? '').trim() || null;
            const name = (company || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.name || '').trim();
            if (!name) continue;
            const isBoth = c.type === 'Both' || (c.isSupplier === true && c.isCustomer === true);
            const contactType = isBoth ? 'both' : 'supplier';

            if (!contactByCin7.has(cin7Id)) {
              const res = await imsExecute(
                `INSERT INTO ims_contacts (type, name, company, email, phone, country, is_active, cin7_supplier_id, cin7_customer_id)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
                [contactType, name, company, c.email || null, c.phone || null, c.country || null, cin7Id,
                 isBoth ? cin7Id : null],
              );
              contactByCin7.set(cin7Id, res.insertId);
              contactNew++;
            } else {
              await imsExecute(
                'UPDATE ims_contacts SET name = ?, type = ?, email = COALESCE(?, email), phone = COALESCE(?, phone), cin7_customer_id = ? WHERE id = ?',
                [name, contactType, c.email || null, c.phone || null,
                 isBoth ? cin7Id : null, contactByCin7.get(cin7Id)!],
              );
            }
          }

          // Import customers (skip contacts already imported as supplier/both)
          const customers = cin7Contacts.filter((c: any) =>
            (c.type === 'Customer' || c.isCustomer === true) && !suppliers.some((s: any) => s.id === c.id),
          );
          const existingCusts = await imsQuery<{ id: number; cin7_customer_id: number | null }>(
            'SELECT id, cin7_customer_id FROM ims_contacts WHERE cin7_customer_id IS NOT NULL',
          );
          const custByCin7 = new Map<number, number>(existingCusts.map(r => [r.cin7_customer_id!, r.id]));
          for (const c of customers) {
            const cin7Id = Number(c.id ?? c.contactId);
            if (!cin7Id || isNaN(cin7Id)) continue;
            const company = (c.company ?? c.companyName ?? '').trim() || null;
            const name = (company || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.name || '').trim();
            if (!name) continue;
            if (!custByCin7.has(cin7Id)) {
              const res = await imsExecute(
                `INSERT INTO ims_contacts (type, name, company, email, phone, country, is_active, cin7_customer_id)
                 VALUES ('customer', ?, ?, ?, ?, ?, 1, ?)`,
                [name, company, c.email || null, c.phone || null, c.country || null, cin7Id],
              );
              custByCin7.set(cin7Id, res.insertId);
              contactNew++;
            } else {
              await imsExecute(
                'UPDATE ims_contacts SET name = ?, email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?',
                [name, c.email || null, c.phone || null, custByCin7.get(cin7Id)!],
              );
            }
          }
          // Re-link POs/SOs that were imported before contacts were synced
          await imsExecute(
            `UPDATE ims_purchase_orders po
             JOIN ims_contacts c ON c.cin7_supplier_id = po.cin7_contact_id
             SET po.supplier_id = c.id
             WHERE po.supplier_id IS NULL AND po.cin7_contact_id IS NOT NULL`,
            [],
          ).catch(() => {});
          // Fallback: infer PO supplier from the most common product supplier in its line items
          await imsExecute(
            `UPDATE ims_purchase_orders po
             SET po.supplier_id = (
               SELECT prod.supplier_contact_id
               FROM ims_purchase_order_items poi
               JOIN ims_product_variants pv ON pv.variant_id = poi.variant_id
               JOIN ims_products prod ON prod.product_id = pv.product_id
               WHERE poi.po_id = po.id AND prod.supplier_contact_id IS NOT NULL
               GROUP BY prod.supplier_contact_id ORDER BY COUNT(*) DESC LIMIT 1
             )
             WHERE po.supplier_id IS NULL
               AND EXISTS (
                 SELECT 1 FROM ims_purchase_order_items poi2
                 JOIN ims_product_variants pv2 ON pv2.variant_id = poi2.variant_id
                 JOIN ims_products prod2 ON prod2.product_id = pv2.product_id
                 WHERE poi2.po_id = po.id AND prod2.supplier_contact_id IS NOT NULL
               )`,
            [],
          ).catch(() => {});
          await imsExecute(
            `UPDATE ims_sales_orders so
             JOIN ims_contacts c ON c.cin7_customer_id = so.cin7_member_id
             SET so.customer_id = c.id
             WHERE so.customer_id IS NULL AND so.cin7_member_id IS NOT NULL`,
            [],
          ).catch(() => {});
          send({ step: 'contacts', status: 'done', count: contactNew, message: `${contactNew} new (${suppliers.length} suppliers, ${customers.length} customers from Cin7)` });
        }

        // Build supplier contact map for products step
        const contactMapRows = await imsQuery<{ id: number; cin7_supplier_id: number }>(
          'SELECT id, cin7_supplier_id FROM ims_contacts WHERE cin7_supplier_id IS NOT NULL',
        );
        const supplierContactMap = new Map<number, number>(
          contactMapRows.map(r => [r.cin7_supplier_id, r.id]),
        );

        // -- Step C+D: Products + Variants from Cin7 /Products --------------
        if (stepsRequested.includes('products')) {
          const modeLabel = syncType === 'full'
            ? 'Full sync — clearing Cin7 products...'
            : 'Fetching modified products from Cin7...';
          send({ step: 'products', status: 'running', message: modeLabel });

          if (syncType === 'full') {
            await imsExecute(
              'DELETE FROM ims_stock WHERE variant_id IN (SELECT variant_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL)',
              [],
            );
            // NULL out order item references before deleting variants (FK constraint — no CASCADE)
            await imsExecute(
              'UPDATE ims_purchase_order_items SET variant_id = NULL WHERE variant_id IN (SELECT variant_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL)',
              [],
            );
            await imsExecute(
              'UPDATE ims_sales_order_items SET variant_id = NULL WHERE variant_id IN (SELECT variant_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL)',
              [],
            );
            await imsExecute('DELETE FROM ims_product_variants WHERE cin7_option_id IS NOT NULL', []);
            await imsExecute('DELETE FROM ims_products WHERE cin7_product_id IS NOT NULL', []);
          }

          const lastSync = await getImsSetting(businessId, 'last_products_sync');
          const extraParams: Record<string, string> = {};
          if (syncType === 'latest' && lastSync) {
            extraParams['modifiedDate'] = lastSync.replace(' ', 'T') + 'Z';
          }

          const existingProds = await imsQuery<{ product_id: string; cin7_product_id: number }>(
            'SELECT product_id, cin7_product_id FROM ims_products WHERE cin7_product_id IS NOT NULL',
          );
          const prodCin7Map = new Map<number, string>(existingProds.map(r => [r.cin7_product_id, r.product_id]));
          // Load existing variants by SKU and barcode for accurate upsert.
          // Size-grid products (sizeRangeId set) have no per-option code; we derive
          // a unique SKU as `productOptionCode-size` and match existing variants by barcode.
          const existingVars = await imsQuery<{ variant_id: string; sku: string | null; barcode: string | null }>(
            'SELECT variant_id, sku, barcode FROM ims_product_variants',
          );
          const variantBySkuMap     = new Map<string, string>(existingVars.filter(r => r.sku).map(r => [r.sku!, r.variant_id]));
          const variantByBarcodeMap = new Map<string, string>(existingVars.filter(r => r.barcode).map(r => [r.barcode!, r.variant_id]));
          const visitedVariantKeys  = new Set<string>(); // prevents pagination-drift duplicates
          const uniqueBrands = new Set<string>();
          let productNew = 0;
          let variantSynced = 0;
          send({ step: 'products', status: 'running', message: 'Fetching and syncing products from Cin7...' });

          const totalProducts = await cin7ForEachPage(creds.authHeader, '/Products', extraParams, 'ims/products', async (pageProducts, pageNum) => {
          send({ step: 'products', status: 'running', message: `Page ${pageNum} — syncing ${pageProducts.length} products...` });
          for (const p of pageProducts) {
            const cin7Id = Number(p.id);
            if (!cin7Id || isNaN(cin7Id)) continue;
            if (p.status === 'Inactive') continue;

            const supplierContactId = p.supplierId
              ? (supplierContactMap.get(Number(p.supplierId)) ?? null)
              : null;
            const isActive   = 1;
            const onlineRaw  = p.customFields?.products_1004;
            const isOnline   = (onlineRaw === 1 || onlineRaw === '1') ? 1 : 0;
            const packSize    = p.customFields?.products_1005 ? Number(p.customFields.products_1005) : null;
            const zone        = p.customFields?.products_1001 ? String(p.customFields.products_1001).trim() : null;
            const bin         = p.customFields?.products_1002 ? String(p.customFields.products_1002).trim() : null;
            const productType = (p.productType || p.category || null) as string | null;
            const createdAt   = p.createdDate ? String(p.createdDate).slice(0, 10) : null;
            const tagsJson   = p.tags
              ? (Array.isArray(p.tags) ? JSON.stringify(p.tags) : String(p.tags))
              : null;

            let imsProdId: string;
            if (!prodCin7Map.has(cin7Id)) {
              imsProdId = uuidv4();
              await imsExecute(
                `INSERT INTO ims_products
                   (product_id, name, description, product_type, brand, tags, style_code,
                    is_active, is_online, supplier_contact_id, cin7_product_id,
                    pack_size, zone, bin, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  imsProdId, (p.name || '').trim() || 'Unknown',
                  p.description || null, productType, p.brand || null,
                  tagsJson, p.styleCode || null,
                  isActive, isOnline, supplierContactId, cin7Id,
                  packSize, zone, bin, createdAt,
                ],
              );
              prodCin7Map.set(cin7Id, imsProdId);
              productNew++;
            } else {
              imsProdId = prodCin7Map.get(cin7Id)!;
              await imsExecute(
                `UPDATE ims_products
                 SET name = ?, description = COALESCE(?, description),
                     product_type = ?, brand = ?,
                     tags = ?, style_code = ?, is_active = ?, is_online = ?,
                     supplier_contact_id = ?, pack_size = ?, zone = ?, bin = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE product_id = ?`,
                [
                  (p.name || '').trim() || 'Unknown',
                  p.description || null, productType, p.brand || null,
                  tagsJson, p.styleCode || null,
                  isActive, isOnline, supplierContactId, packSize, zone, bin,
                  imsProdId,
                ],
              );
              if (createdAt) {
                await imsExecute(
                  'UPDATE ims_products SET created_at = ? WHERE product_id = ? AND created_at IS NULL',
                  [createdAt, imsProdId],
                );
              }
            }

            const opts: any[] = Array.isArray(p.productOptions) ? p.productOptions : [];
            const opt1Name = p.optionLabel1 || null;
            const opt2Name = p.optionLabel2 || null;
            const opt3Name = p.optionLabel3 || null;

            for (const opt of opts) {
              const cin7OptId = Number(opt.id ?? opt.productOptionId);
              if (!cin7OptId || isNaN(cin7OptId)) continue;

              // For regular products: opt.code is the per-variant SKU.
              // For size-grid products (sizeRangeId set): opt.code is null; derive a
              // unique SKU from productOptionCode + size (e.g. "SRS-SPA-3 to 6 months").
              const optSku = opt.code || (
                opt.productOptionCode && opt.size
                  ? `${opt.productOptionCode}-${opt.size}`
                  : null
              );
              // Skip if already processed (Cin7 pagination drift can return same product on multiple pages)
              const variantKey = (opt.barcode || '') + ':' + (optSku || '') + ':' + cin7OptId;
              if (visitedVariantKeys.has(variantKey)) continue;
              visitedVariantKeys.add(variantKey);
              // option1_value: use explicit option1 or fall back to size dimension
              const opt1Value = opt.option1 || opt.size || null;
              const opt1NameResolved = opt1Name || (opt.size ? 'Size' : null);

              const cost_aud        = opt.priceColumns?.costAUD ?? opt.priceColumns?.cost_aud ?? opt.cost_aud ?? null;
              const price_rrp       = opt.retailPrice ?? opt.price_rrp ?? opt.priceColumns?.retailAUD ?? opt.priceColumns?.price_rrp ?? null;
              const price_wholesale = opt.wholesalePrice ?? opt.price_wholesale ?? opt.priceColumns?.wholesaleAUD ?? opt.priceColumns?.price_wholesale ?? null;
              const price_rrp_sale  = opt.specialPrice ?? opt.priceColumns?.specialPrice ?? null;
              // Cin7 stores discount as a start date + duration in days; compute end date
              const discStartStr = opt.specialsStartDate ? String(opt.specialsStartDate).slice(0, 10) : null;
              const discDays = opt.specialDays ? Number(opt.specialDays) : 0;
              let discEndStr: string | null = null;
              if (discStartStr && discDays > 0) {
                const d = new Date(discStartStr + 'T00:00:00Z');
                d.setUTCDate(d.getUTCDate() + discDays);
                discEndStr = d.toISOString().slice(0, 10);
              }
              const weightKg       = opt.optionWeight != null ? Number(opt.optionWeight) : null;

              const foreignCosts: Record<string, number> = {};
              if (opt.priceColumns) {
                for (const [k, v] of Object.entries(opt.priceColumns as Record<string, any>)) {
                  if (k.startsWith('cost_') && k !== 'cost_aud' && v != null && Number(v) !== 0) {
                    foreignCosts[k.replace('cost_', '')] = Number(v);
                  }
                }
              }
              const foreignCostJson = Object.keys(foreignCosts).length
                ? JSON.stringify(foreignCosts)
                : null;

              // Look up by SKU first, then barcode (for existing null-sku size-grid variants)
              const existingVariantId = (optSku ? variantBySkuMap.get(optSku) : undefined)
                ?? (opt.barcode ? variantByBarcodeMap.get(opt.barcode) : undefined);

              if (existingVariantId) {
                await imsExecute(
                  `UPDATE ims_product_variants SET
                     product_id = ?, sku = ?, barcode = ?,
                     option1_name = ?, option1_value = ?,
                     option2_name = ?, option2_value = ?,
                     option3_name = ?, option3_value = ?,
                     cost_aud = ?, price_rrp = ?, price_wholesale = ?,
                     price_rrp_sale = ?, discount_start_date = ?, discount_end_date = ?,
                     cost_foreign = ?,
                     weight_kg = ?, is_active = ?, cin7_option_id = ?, pack_size = ?,
                     updated_at = CURRENT_TIMESTAMP
                   WHERE variant_id = ?`,
                  [
                    imsProdId, optSku, opt.barcode || null,
                    opt1NameResolved, opt1Value,
                    opt2Name, opt.option2 || null,
                    opt3Name, opt.option3 || null,
                    cost_aud        != null ? Number(cost_aud)        : null,
                    price_rrp       != null ? Number(price_rrp)       : null,
                    price_wholesale != null ? Number(price_wholesale) : null,
                    price_rrp_sale  != null ? Number(price_rrp_sale)  : null,
                    discStartStr, discEndStr,
                    foreignCostJson, weightKg, isActive, cin7OptId, packSize,
                    existingVariantId,
                  ],
                );
                if (optSku) variantBySkuMap.set(optSku, existingVariantId);
                if (opt.barcode) variantByBarcodeMap.set(opt.barcode, existingVariantId);
              } else {
                const newVariantId = uuidv4();
                await imsExecute(
                  `INSERT INTO ims_product_variants
                     (variant_id, product_id, sku, barcode,
                      option1_name, option1_value,
                      option2_name, option2_value,
                      option3_name, option3_value,
                      cost_aud, price_rrp, price_wholesale,
                      price_rrp_sale, discount_start_date, discount_end_date,
                      cost_foreign,
                      weight_kg, is_active, cin7_option_id, pack_size)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    newVariantId, imsProdId,
                    optSku, opt.barcode || null,
                    opt1NameResolved, opt1Value,
                    opt2Name, opt.option2 || null,
                    opt3Name, opt.option3 || null,
                    cost_aud        != null ? Number(cost_aud)        : null,
                    price_rrp       != null ? Number(price_rrp)       : null,
                    price_wholesale != null ? Number(price_wholesale) : null,
                    price_rrp_sale  != null ? Number(price_rrp_sale)  : null,
                    discStartStr, discEndStr,
                    foreignCostJson, weightKg, isActive, cin7OptId, packSize,
                  ],
                );
                if (optSku) variantBySkuMap.set(optSku, newVariantId);
                if (opt.barcode) variantByBarcodeMap.set(opt.barcode, newVariantId);
              }
              variantSynced++;
            }
            if (p.brand) uniqueBrands.add(p.brand.trim());
          } // end for pageProducts
          send({ step: 'products', status: 'running', message: `Page ${pageNum} done — ${productNew} products, ${variantSynced} variants so far` });
          }); // end cin7ForEachPage

          // Upsert unique brands into ims_brands
          for (const brand of uniqueBrands) {
            await imsExecute(
              'INSERT INTO ims_brands (name) SELECT ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM ims_brands WHERE name = ?)',
              [brand, brand],
            );
          }

          await setImsSetting(businessId, 'last_products_sync', nowStr);
          send({
            step: 'products', status: 'done', count: productNew,
            message: `${productNew} new products, ${variantSynced} variants synced (${totalProducts} from Cin7)`,
          });
        }

        // -- Step E: Stock from Cin7 /Stock ---------------------------------
        if (stepsRequested.includes('stock')) {
          send({ step: 'stock', status: 'running', message: 'Fetching stock levels from Cin7...' });

          const cin7Stock = await cin7FetchAllPages(creds.authHeader, '/Stock', {}, 'ims/stock');
          send({ step: 'stock', status: 'running', message: `Processing ${cin7Stock.length} stock records...` });

          const allLocs = await imsQuery<{ id: number; cin7_branch_id: number | null; name: string }>(
            'SELECT id, cin7_branch_id, name FROM ims_locations',
          );
          const locByBranchId = new Map<number, number>(
            allLocs.filter(r => r.cin7_branch_id != null).map(r => [r.cin7_branch_id!, r.id]),
          );
          const locByName = new Map<string, number>(allLocs.map(r => [r.name, r.id]));

          // Load variants by SKU (primary) and barcode (fallback for size-grid products
          // where /Stock returns a unique barcode per size but a shared product-level code)
          const allVariants = await imsQuery<{ variant_id: string; sku: string | null; barcode: string | null; cost_aud: number | null }>(
            'SELECT variant_id, sku, barcode, cost_aud FROM ims_product_variants',
          );
          const variantByCode = new Map<string, { variantId: string; cost_aud: number | null }>(
            allVariants.filter(r => r.sku).map(r => [r.sku!, { variantId: r.variant_id, cost_aud: r.cost_aud }]),
          );
          const variantByBarcode = new Map<string, { variantId: string; cost_aud: number | null }>(
            allVariants.filter(r => r.barcode).map(r => [r.barcode!, { variantId: r.variant_id, cost_aud: r.cost_aud }]),
          );

          const stockAgg = new Map<string, {
            variantId: string; locationId: number;
            soh: number; incoming: number; committed: number; avgCost: number | null;
          }>();

          for (const s of cin7Stock) {
            const cin7BranchId = Number(s.branchId ?? s.BranchId);
            const stockCode    = (s.code ?? '').trim();
            const stockSize    = (s.size ?? '').trim();
            const stockBarcode = (s.barcode ?? '').trim();
            // Skip only if no code AND no barcode (size-grid products have code="" but valid barcode)
            if ((!stockCode && !stockBarcode) || !cin7BranchId) continue;

            const stockSkuFromSize = stockSize ? `${stockCode}-${stockSize}` : '';
            const variantMatch = variantByCode.get(stockCode)
              ?? (stockSkuFromSize ? variantByCode.get(stockSkuFromSize) : undefined)
              ?? (stockBarcode ? variantByBarcode.get(stockBarcode) : undefined);
            if (!variantMatch) continue;
            const { variantId, cost_aud: avgCostFallback } = variantMatch;

            const locationId = locByBranchId.get(cin7BranchId)
              ?? locByName.get((s.branchName ?? '').trim());
            if (!locationId) continue;

            const key = `${variantId}:${locationId}`;
            if (!stockAgg.has(key)) {
              stockAgg.set(key, {
                variantId, locationId, soh: 0, incoming: 0, committed: 0,
                avgCost: avgCostFallback,
              });
            }
            const entry = stockAgg.get(key)!;
            entry.soh       += Number(s.stockOnHand ?? 0);
            entry.incoming  += Number(s.incoming    ?? 0);
            entry.committed += Number(s.openSales   ?? 0);
          }

          let stockSynced = 0;
          for (const s of stockAgg.values()) {
            await imsExecute(
              `INSERT INTO ims_stock
                 (variant_id, location_id, qty_on_hand, qty_incoming, qty_committed, avg_cost)
               VALUES (?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 qty_on_hand   = VALUES(qty_on_hand),
                 qty_incoming  = VALUES(qty_incoming),
                 qty_committed = VALUES(qty_committed),
                 avg_cost      = COALESCE(VALUES(avg_cost), avg_cost),
                 updated_at    = CURRENT_TIMESTAMP`,
              [s.variantId, s.locationId, s.soh, s.incoming, s.committed, s.avgCost],
            );
            stockSynced++;
          }
          send({ step: 'stock', status: 'done', count: stockSynced, message: `${stockSynced} stock records synced` });
        }

        // -- Shared variant-by-SKU map for sales + PO line items -----------
        const sharedVariantRows = await imsQuery<{ variant_id: string; sku: string }>(
          'SELECT variant_id, sku FROM ims_product_variants WHERE sku IS NOT NULL',
        );
        const variantBySku = new Map<string, string>(sharedVariantRows.map(r => [r.sku, r.variant_id]));

        // -- Step F: Sales from Cin7 /SalesOrders ---------------------------
        if (stepsRequested.includes('sales')) {
          const lastSalesSync = await getImsSetting(businessId, 'last_sales_sync');
          const salesExtraParams: Record<string, string> = {};

          if (syncType === 'full' || !lastSalesSync) {
            const cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - salesMonths);
            salesExtraParams['where'] = `createdDate>='${cutoff.toISOString().replace(/\.\d{3}Z$/, 'Z')}'`;
            send({ step: 'sales', status: 'running', message: `Full sync: clearing sales and importing ${salesMonths} month(s) from Cin7...` });
            await imsExecute('DELETE FROM ims_sales_history', []);
            await imsExecute('TRUNCATE TABLE ims_sales_cache', []);
            await imsExecute('DELETE FROM ims_sales_orders WHERE cin7_order_id IS NOT NULL', []);
            await imsExecute('DELETE FROM pos_sales WHERE is_historical = 1', []);
          } else {
            salesExtraParams['modifiedDate'] = lastSalesSync.replace(' ', 'T') + 'Z';
            send({ step: 'sales', status: 'running', message: `Latest sync: fetching changes since ${lastSalesSync}...` });
          }

          // Load lookup maps for SO management records
          const soLocRows = await imsQuery<{ id: number; cin7_branch_id: number | null }>(
            'SELECT id, cin7_branch_id FROM ims_locations WHERE cin7_branch_id IS NOT NULL', [],
          );
          const soLocByBranch = new Map<number, number>(soLocRows.map(r => [r.cin7_branch_id!, r.id]));
          const soCustRows = await imsQuery<{ id: number; cin7_customer_id: number | null }>(
            'SELECT id, cin7_customer_id FROM ims_contacts WHERE cin7_customer_id IS NOT NULL', [],
          );
          const soCustByCin7 = new Map<number, number>(soCustRows.map(r => [r.cin7_customer_id!, r.id]));
          const soUnknownLocId = await getOrCreateUnknownLoc();

          let salesOrderCount = 0;
          await cin7ForEachPage(creds.authHeader, '/SalesOrders', salesExtraParams, 'ims/sales', async (pageOrders, pageNum) => {
            send({ step: 'sales', status: 'running', message: `Syncing page ${pageNum} (${salesOrderCount} orders so far)...` });
          for (const order of pageOrders) {
            if (syncType === 'latest') {
              await imsExecute('DELETE FROM ims_sales_history WHERE cin7_order_id = ?', [String(order.id)]);
              await imsExecute('DELETE FROM ims_sales_orders WHERE cin7_order_id = ?', [String(order.id)]);
              await imsExecute('DELETE FROM pos_sales WHERE local_id = ?', [String(order.id)]);
            }

            const lines: any[] = Array.isArray(order.lineItems) ? order.lineItems : [];
            const invoiceDateRaw: string = order.invoiceDate ?? order.createdDate ?? '';
            const invoiceDateStr = invoiceDateRaw ? invoiceDateRaw.slice(0, 10) : null;
            const orderDate = invoiceDateStr || new Date().toISOString().slice(0, 10);
            const amountDue = order.amountDue != null ? Number(order.amountDue) : null;

            // Write sales history lines
            for (const line of lines) {
              const cin7OptId = line.productOptionId ?? line.optionId;
              const qty = Number(line.qty ?? 0);
              if (!cin7OptId || qty === 0) continue;

              const unitPrice = Number(line.unitPrice ?? line.price_rrp ?? 0);
              const lineDiscount = Number(line.discount ?? 0);
              const lineTotal = Math.round(qty * unitPrice * (1 - lineDiscount / 100) * 10000) / 10000;
              // Resolve variant_id by SKU (handles size-grid products with shared cin7_option_id)
              const lineVariantId = (line.code ? variantBySku.get(line.code) : undefined) ?? null;

              await imsExecute(
                `INSERT INTO ims_sales_history
                   (cin7_order_id, variant_id, cin7_option_id, sku, product_name,
                    branch_id, invoice_date, qty, unit_price, line_total, amount_due, source,
                    reference, stage)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  String(order.id), lineVariantId, Number(cin7OptId),
                  line.code || null, line.name || null,
                  order.branchId ? Number(order.branchId) : null,
                  invoiceDateStr, qty, unitPrice, lineTotal, amountDue,
                  order.source || null, order.reference || null, order.stage || null,
                ],
              );
            }

            // Classify order type
            const orderSource = (order.source ?? '').toLowerCase();
            const orderProject = (order.projectName ?? '').toLowerCase();
            const soType = orderSource.startsWith('pos-') ? 'pos'
              : (orderSource.includes('shopify') || orderProject.includes('shopify')) ? 'online'
              : 'b2b';

            if (soType === 'pos') {
              // Write POS order to pos_sales (is_historical=1) so it appears in the POS Sales
              // view and the Xero daily-batch sync history, grouped by date + location.
              const posLocationId = soLocByBranch.get(Number(order.branchId ?? 0)) ?? soUnknownLocId;
              const posTotal      = Number(order.amountDue ?? order.total ?? 0);
              // Resolve tax rate/status first so we can normalise all amounts to ex-tax
              const posTaxRate   = Number(order.taxRate ?? 0);
              const posTaxStatus = String(order.taxStatus ?? 'Excl').toUpperCase();
              const isPosIncl    = posTaxRate > 0 && posTaxStatus.startsWith('INCL');
              const posExTax     = (v: number) => isPosIncl ? Math.round(v / (1 + posTaxRate) * 10000) / 10000 : v;
              // Subtotal from Cin7 productTotal (may be GST-inclusive for POS); normalise to ex-tax
              const posSubtotalRaw = Number(order.productTotal ?? 0) || lines.reduce((s: number, l: any) => {
                const lQty  = Number(l.qty ?? 0);
                const lUp   = Number(l.unitPrice ?? l.price_rrp ?? 0);
                const lDisc = Number(l.discount ?? 0);
                return s + Math.round(lQty * lUp * (1 - lDisc / 100) * 10000) / 10000;
              }, 0);
              const posSubtotal  = posExTax(posSubtotalRaw);
              const posDiscount  = posExTax(Number(order.discountTotal ?? order.discount ?? 0));
              const posFreight   = posExTax(Number(order.freightTotal ?? order.freight ?? 0));
              const posSurcharge = posExTax(Number(order.surcharge ?? 0));
              const posBase      = posSubtotal + posFreight - posDiscount + posSurcharge;
              const posTax       = posTaxRate === 0 ? 0
                : isPosIncl ? posTotal * posTaxRate / (1 + posTaxRate)
                : posBase * posTaxRate;
              const posCustomer  = order.memberName ?? order.customerName ?? order.reference ?? null;
              const posResult = await imsExecute(
                `INSERT INTO pos_sales
                   (local_id, location_id, cashier_id, sale_type, status,
                    customer_name, customer_phone, subtotal, discount_total, tax_total, total,
                    notes, completed_at, is_historical)
                 VALUES (?, ?, NULL, 'sale', 'completed', ?, NULL, ?, ?, ?, ?, NULL, ?, 1)`,
                [String(order.id), posLocationId, posCustomer,
                 posSubtotal, posDiscount, posTax, posTotal, orderDate],
              );
              const posInsertId = posResult.insertId;
              // Insert line items into pos_sale_items
              const posLineTaxRatePct = Math.round(posTaxRate * 100 * 100) / 100; // store as % (10.00)
              for (const line of lines) {
                const lCin7OptId = line.productOptionId ?? line.optionId;
                const lQty = Number(line.qty ?? 0);
                if (!lCin7OptId || lQty === 0) continue;
                const lUnitPrice = Number(line.unitPrice ?? line.price_rrp ?? 0);
                const lDisc = Number(line.discount ?? 0);
                const lLineTotal = Math.round(lQty * lUnitPrice * (1 - lDisc / 100) * 10000) / 10000;
                const lDiscAmt = Math.round(lUnitPrice * lQty * (lDisc / 100) * 100) / 100;
                const lVariantId = (line.code ? variantBySku.get(line.code) : undefined) ?? null;
                try {
                  await imsExecute(
                    `INSERT INTO pos_sale_items
                       (sale_id, variant_id, code, name, qty, unit_price,
                        discount_type, discount_value, discount_amount, tax_rate, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [posInsertId, lVariantId, line.code || null, line.name || '',
                     lQty, lUnitPrice,
                     lDisc > 0 ? 'percent' : 'none', lDisc, lDiscAmt,
                     posLineTaxRatePct, lLineTotal],
                  );
                } catch { /* skip item if insert fails */ }
              }
              salesOrderCount++;
              continue;
            }

            // Write SO management record
            const { status: soStatus, isHistorical } = cinSoStageToIms(order.stage ?? '', order.status ?? '');
            const soCustomerId = soCustByCin7.get(Number(order.memberId ?? order.customerId ?? 0)) ?? null;
            const soLocationId = soLocByBranch.get(Number(order.branchId ?? 0)) ?? soUnknownLocId;
            const soNumber = (order.reference ?? '').trim() || `CIN7-${order.id}`;
            const rawExpected = order.deliveryDate ?? order.requiredDate ?? '';
            const expectedDateStr = rawExpected ? String(rawExpected).slice(0, 10) : null;
            const fulfilledDate = soStatus === 'fulfilled' ? orderDate : null;
            // Compute subtotal from line items (Cin7 SOs rarely include lineTotal on each line)
            const computedSoSubtotal = lines.reduce((s: number, l: any) => {
              const qty = Number(l.qty ?? 0);
              const unitPrice = Number(l.unitPrice ?? l.price_rrp ?? 0);
              const disc = Number(l.discount ?? 0);
              return s + Math.round(qty * unitPrice * (1 - disc / 100) * 10000) / 10000;
            }, 0);
            // Resolve tax rate/status first so we can normalise all amounts to ex-tax
            const soTaxRate   = Number(order.taxRate ?? 0);
            const soTaxStatus = String(order.taxStatus ?? 'Excl').toUpperCase();
            const isSoIncl    = soTaxRate > 0 && soTaxStatus.startsWith('INCL');
            const soExTax     = (v: number) => isSoIncl ? Math.round(v / (1 + soTaxRate) * 10000) / 10000 : v;
            // Normalise all line-level amounts to ex-tax
            const subtotalRaw = order.productTotal != null ? Number(order.productTotal) : computedSoSubtotal;
            const subtotal    = soExTax(subtotalRaw);
            const soFreight   = soExTax(Number(order.freightTotal ?? order.freight ?? 0));
            const soDiscount  = soExTax(Number(order.discountTotal ?? order.discount ?? 0));
            const soSurcharge = soExTax(Number(order.surcharge ?? 0));
            const soBase = subtotal + soFreight - soDiscount + soSurcharge;
            // Grand total: for Incl, order.total already includes tax; for Excl, add tax on top
            const totalAmt = Number(order.total ?? soBase * (1 + (isSoIncl ? 0 : soTaxRate)));
            const taxAmt = soTaxRate === 0 ? 0
              : isSoIncl ? totalAmt * soTaxRate / (1 + soTaxRate)
              : soBase * soTaxRate;
            const soCurrencyCode = (order.currencyCode ?? 'AUD').toUpperCase();
            const soExchangeRate = Number(order.exchangeRate ?? order.currencyRate ?? 1);

            let soInsertId: number;
            try {
              const rawSoMemberId = Number(order.memberId ?? order.customerId ?? 0) || null;
              const soRes = await imsExecute(
                `INSERT INTO ims_sales_orders
                   (so_number, customer_id, location_id, status, order_date, expected_date,
                    fulfilled_date, freight, discount, subtotal, tax_amount, total_amount,
                    cin7_order_id, is_historical, currency_code, exchange_rate, so_type, cin7_member_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [soNumber, soCustomerId, soLocationId, soStatus, orderDate, expectedDateStr,
                 fulfilledDate, soFreight, soDiscount, subtotal, taxAmt, totalAmt,
                 String(order.id), isHistorical, soCurrencyCode, soExchangeRate, soType, rawSoMemberId],
              );
              soInsertId = soRes.insertId;
            } catch {
              const rawSoMemberId = Number(order.memberId ?? order.customerId ?? 0) || null;
              const soRes = await imsExecute(
                `INSERT INTO ims_sales_orders
                   (so_number, customer_id, location_id, status, order_date, expected_date,
                    fulfilled_date, freight, discount, subtotal, tax_amount, total_amount,
                    cin7_order_id, is_historical, currency_code, exchange_rate, so_type, cin7_member_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [`CIN7-${order.id}`, soCustomerId, soLocationId, soStatus, orderDate, expectedDateStr,
                 fulfilledDate, soFreight, soDiscount, subtotal, taxAmt, totalAmt,
                 String(order.id), isHistorical, soCurrencyCode, soExchangeRate, soType, rawSoMemberId],
              );
              soInsertId = soRes.insertId;
            }

            for (const line of lines) {
              const cin7OptId = line.productOptionId ?? line.optionId;
              const qty = Number(line.qty ?? 0);
              if (!cin7OptId || qty === 0) continue;
              const unitPrice = Number(line.unitPrice ?? line.price_rrp ?? 0);
              const lineDiscount = Number(line.discount ?? 0);
              const lineTotal = Math.round(qty * unitPrice * (1 - lineDiscount / 100) * 10000) / 10000;
              const soItemVariantId = (line.code ? variantBySku.get(line.code) : undefined) ?? null;
              // Cin7 line taxRate can be percentage (10) or decimal (0.1) — normalise to decimal
              const rawLineTaxRate = line.taxRate != null ? Number(line.taxRate) : null;
              const lineItemSoTaxRate = rawLineTaxRate != null
                ? (rawLineTaxRate > 1 ? rawLineTaxRate / 100 : rawLineTaxRate)
                : (soTaxStatus.startsWith('EXCL') ? soTaxRate : 0);
              try {
                await imsExecute(
                  `INSERT INTO ims_sales_order_items
                     (so_id, variant_id, code, name, qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [soInsertId, soItemVariantId, line.code || null, line.name || null,
                   qty, isHistorical ? qty : 0, unitPrice, lineDiscount, lineItemSoTaxRate, lineTotal, line.name || null],
                );
              } catch { /* skip if variant not in catalog */ }
            }
            salesOrderCount++;
          } // end for order
          }); // end cin7ForEachPage

          send({ step: 'sales', status: 'running', message: 'Rebuilding sales cache...' });
          await imsExecute(
            `INSERT INTO ims_sales_cache
               (variant_id, sales_qty_7d, sales_qty_90d, sales_qty_180d, sales_qty_12m, updated_at)
             SELECT
               variant_id,
               SUM(CASE WHEN invoice_date >= DATE_SUB(CURDATE(), INTERVAL 7   DAY) THEN qty ELSE 0 END),
               SUM(CASE WHEN invoice_date >= DATE_SUB(CURDATE(), INTERVAL 90  DAY) THEN qty ELSE 0 END),
               SUM(CASE WHEN invoice_date >= DATE_SUB(CURDATE(), INTERVAL 180 DAY) THEN qty ELSE 0 END),
               SUM(CASE WHEN invoice_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY) THEN qty ELSE 0 END),
               NOW()
             FROM ims_sales_history
             WHERE invoice_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
               AND variant_id IS NOT NULL
             GROUP BY variant_id
             ON DUPLICATE KEY UPDATE
               sales_qty_7d   = VALUES(sales_qty_7d),
               sales_qty_90d  = VALUES(sales_qty_90d),
               sales_qty_180d = VALUES(sales_qty_180d),
               sales_qty_12m  = VALUES(sales_qty_12m),
               updated_at     = VALUES(updated_at)`,
            [],
          );

          const histRows  = await imsQuery<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM ims_sales_history', []);
          const cacheRows = await imsQuery<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM ims_sales_cache', []);
          await setImsSetting(businessId, 'last_sales_sync', nowStr);
          send({
            step: 'sales', status: 'done',
            count: histRows[0]?.cnt ?? 0,
            message: `${salesOrderCount} orders — ${histRows[0]?.cnt ?? 0} lines, ${cacheRows[0]?.cnt ?? 0} variants in cache`,
          });
        }

        // -- Step G: Purchase Orders from Cin7 /PurchaseOrders -------------
        if (stepsRequested.includes('pos')) {
          const lastPosSync = await getImsSetting(businessId, 'last_pos_sync');
          const posExtraParams: Record<string, string> = {};

          if (syncType === 'full' || !lastPosSync) {
            const cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - poMonths);
            posExtraParams['where'] = `createdDate>='${cutoff.toISOString().replace(/\.\d{3}Z$/, 'Z')}'`;
            send({ step: 'pos', status: 'running', message: `Full sync: clearing Cin7-sourced purchase orders and importing ${poMonths} month(s)...` });
            await imsExecute('DELETE FROM ims_purchase_orders WHERE cin7_order_id IS NOT NULL', []);
          } else {
            posExtraParams['modifiedDate'] = lastPosSync.replace(' ', 'T') + 'Z';
            send({ step: 'pos', status: 'running', message: `Latest sync: fetching POs modified since ${lastPosSync}...` });
          }

          const poLocRows = await imsQuery<{ id: number; cin7_branch_id: number | null }>(
            'SELECT id, cin7_branch_id FROM ims_locations WHERE cin7_branch_id IS NOT NULL', [],
          );
          const poLocByBranch = new Map<number, number>(poLocRows.map(r => [r.cin7_branch_id!, r.id]));
          const poSupplierRows = await imsQuery<{ id: number; cin7_supplier_id: number | null }>(
            'SELECT id, cin7_supplier_id FROM ims_contacts WHERE cin7_supplier_id IS NOT NULL', [],
          );
          const poSupplierByCin7 = new Map<number, number>(poSupplierRows.map(r => [r.cin7_supplier_id!, r.id]));
          const poUnknownLocId = await getOrCreateUnknownLoc();

          let poImported = 0;
          await cin7ForEachPage(creds.authHeader, '/PurchaseOrders', posExtraParams, 'ims/pos', async (pagePOs, pageNum) => {
            send({ step: 'pos', status: 'running', message: `Syncing page ${pageNum} (${poImported} POs so far)...` });
          for (const po of pagePOs) {
            const cin7PoId = String(po.id ?? '');
            if (!cin7PoId) continue;

            if (syncType === 'latest') {
              await imsExecute('DELETE FROM ims_purchase_orders WHERE cin7_order_id = ?', [cin7PoId]);
            }

            const { status: poStatus, isHistorical } = cinPoStageToIms(po.stage ?? '');
            const cin7SuppId = Number(po.memberId ?? po.contactId ?? po.supplierId ?? 0);
            const supplierNameRaw = ((po.company ?? po.companyName ?? '') || `${po.firstName ?? ''} ${po.lastName ?? ''}`.trim() || null) as string | null;
            const supplierId = cin7SuppId ? (poSupplierByCin7.get(cin7SuppId) ?? null) : null;
            const locationId = poLocByBranch.get(Number(po.branchId ?? 0)) ?? poUnknownLocId;
            const poNumber = (po.reference ?? '').trim() || `CIN7-${po.id}`;
            const orderDate = String(po.createdDate ?? po.orderDate ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
            const rawExpected = po.deliveryDate ?? po.dueDate ?? '';
            const expectedDate = rawExpected ? String(rawExpected).slice(0, 10) : null;
            const receivedDate = poStatus === 'received' ? (expectedDate || orderDate) : null;
            const paymentTerms = po.paymentTerms ?? po.terms ?? null;
            const supplierInvoiceNumber = po.supplierInvoiceNumber ?? po.invoiceNumber ?? null;
            const poLines: any[] = Array.isArray(po.lineItems) ? po.lineItems : [];
            const computedSubtotal = poLines.reduce((s: number, l: any) => {
              const qty = Number(l.qty ?? 0);
              const unitCost = Number(l.unitPrice ?? l.price_rrp ?? l.unitCost ?? 0);
              return s + Number(l.lineTotal ?? l.total ?? qty * unitCost);
            }, 0);
            const subtotal = po.productTotal != null ? Number(po.productTotal) : computedSubtotal;
            const freight = Number(po.freight ?? po.freightCost ?? po.freightTotal ?? 0);
            const discount = Number(po.discount ?? po.discountTotal ?? 0);
            // Cin7 encodes tax via taxStatus + taxRate (no taxTotal field)
            const poTaxRate = Number(po.taxRate ?? 0);
            const poTaxStatus = String(po.taxStatus ?? 'Excl').toUpperCase();
            const poBase = subtotal + freight - discount + Number(po.surcharge ?? 0);
            const taxTreatment = poTaxRate === 0 ? 'no_tax' : poTaxStatus.startsWith('INCL') ? 'inc_tax' : 'ex_tax';
            const totalAmt = Number(po.total ?? (poBase * (1 + (taxTreatment === 'ex_tax' ? poTaxRate : 0))));
            const taxAmt = poTaxRate === 0 ? 0
              : taxTreatment === 'inc_tax' ? totalAmt * poTaxRate / (1 + poTaxRate)
              : poBase * poTaxRate;
            const lineItemTaxRate = taxTreatment === 'ex_tax' ? poTaxRate : 0;
            const poCurrencyCode = (po.currencyCode ?? po.currency ?? 'AUD').toUpperCase();
            const poExchangeRate = Number(po.exchangeRate ?? po.currencyRate ?? 1);

            let poInsertId: number;
            try {
              const poRes = await imsExecute(
                `INSERT INTO ims_purchase_orders
                   (po_number, supplier_id, supplier_name_raw, location_id, status, order_date, expected_date,
                    received_date, notes, payment_terms, supplier_invoice_number, freight, discount,
                    subtotal, tax_amount, total_amount, cin7_order_id, is_historical,
                    currency_code, exchange_rate, cin7_contact_id, tax_treatment)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [poNumber, supplierId, supplierNameRaw, locationId, poStatus, orderDate, expectedDate,
                 receivedDate, po.notes || null, paymentTerms ? String(paymentTerms) : null,
                 supplierInvoiceNumber,
                 freight, discount, subtotal, taxAmt, totalAmt, cin7PoId, isHistorical,
                 poCurrencyCode, poExchangeRate, cin7SuppId || null, taxTreatment],
              );
              poInsertId = poRes.insertId;
            } catch {
              const poRes = await imsExecute(
                `INSERT INTO ims_purchase_orders
                   (po_number, supplier_id, supplier_name_raw, location_id, status, order_date, expected_date,
                    received_date, notes, payment_terms, supplier_invoice_number, freight, discount,
                    subtotal, tax_amount, total_amount, cin7_order_id, is_historical,
                    currency_code, exchange_rate, cin7_contact_id, tax_treatment)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [`CIN7-${po.id}`, supplierId, supplierNameRaw, locationId, poStatus, orderDate, expectedDate,
                 receivedDate, po.notes || null, paymentTerms ? String(paymentTerms) : null,
                 supplierInvoiceNumber,
                 freight, discount, subtotal, taxAmt, totalAmt, cin7PoId, isHistorical,
                 poCurrencyCode, poExchangeRate, cin7SuppId || null, taxTreatment],
              );
              poInsertId = poRes.insertId;
            }

            for (const line of poLines) {
              const cin7OptId = line.productOptionId ?? line.productId;
              const qty = Number(line.qty ?? 0);
              if (!cin7OptId || qty === 0) continue;
              const unitCost = Number(line.unitPrice ?? line.price_rrp ?? line.unitCost ?? 0);
              // Cin7 PO line.discount is a dollar amount (not a percentage)
              const lineDiscAmt = Number(line.discount ?? 0);
              const lineSub = qty * unitCost;
              const lineDiscount = lineSub > 0 ? (lineDiscAmt / lineSub) * 100 : 0;
              const lineTotal = Math.round((lineSub - lineDiscAmt) * 10000) / 10000;
              const poItemVariantId = (line.code ? variantBySku.get(line.code) : undefined) ?? null;
              try {
                await imsExecute(
                  `INSERT INTO ims_purchase_order_items
                     (po_id, variant_id, qty_ordered, qty_received, unit_cost, discount_pct, tax_rate, line_total, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [poInsertId, poItemVariantId, qty, poStatus === 'received' ? qty : 0,
                   unitCost, lineDiscount, lineItemTaxRate, lineTotal, line.name || null],
                );
              } catch { /* skip if variant not in catalog */ }
            }
            poImported++;
          } // end for po
          }); // end cin7ForEachPage

          await setImsSetting(businessId, 'last_pos_sync', nowStr);
          send({
            step: 'pos', status: 'done', count: poImported,
            message: `${poImported} purchase orders imported`,
          });
        }

        send({ step: 'complete', status: 'done', message: 'Sync complete!' });

      } catch (e: any) {
        send({ step: 'error', status: 'error', message: `Error: ${e.message}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
