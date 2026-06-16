import { v4 as uuidv4 } from 'uuid';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { getImportSession, getLegacyConn, makeSSEStream } from '../_helpers';

export async function POST() {
  const session = getImportSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const businessId: string = session.userSpreadsheetId;

  return makeSSEStream(async (send) => {
    send({ status: 'running', message: 'Reading products from database...' });

    const conn = await getLegacyConn(businessId);
    try {
      const [rows] = await conn.execute<any[]>(
        `SELECT cin7_id, option_id, code, style_code, barcode, name, brand,
                supplier_id, option_label, online, pack_size, cost, retail_price
         FROM products WHERE business_id = ? ORDER BY cin7_id, option_id`,
        [businessId],
      );
      send({ status: 'running', message: `Found ${rows.length} product rows. Processing...` });

      // Pre-load cin7 supplier_id → ims_contacts.id map
      const contacts = await imsQuery<{ id: number; cin7_supplier_id: number }>(
        'SELECT id, cin7_supplier_id FROM ims_contacts WHERE cin7_supplier_id IS NOT NULL',
      );
      const supplierMap = new Map(contacts.map(c => [c.cin7_supplier_id, c.id]));

      // Pre-load existing IMS products by cin7_product_id
      const existingProds = await imsQuery<{ product_id: string; cin7_product_id: number }>(
        'SELECT product_id, cin7_product_id FROM ims_products WHERE cin7_product_id IS NOT NULL',
      );
      const prodMap = new Map(existingProds.map(p => [p.cin7_product_id, p.product_id]));

      // Pre-load existing variants by SKU (primary) and cin7_option_id (fallback)
      const existingVars = await imsQuery<{ variant_id: string; cin7_option_id: number; sku: string | null }>(
        'SELECT variant_id, cin7_option_id, sku FROM ims_product_variants WHERE cin7_option_id IS NOT NULL',
      );
      const variantBySkuMap = new Map(existingVars.filter(v => v.sku).map(v => [v.sku!, v.variant_id]));
      const variantMap = new Map(existingVars.map(v => [v.cin7_option_id, v.variant_id]));

      // Group rows by cin7_id → one parent product
      const byCin7 = new Map<number, typeof rows>();
      for (const r of rows) {
        if (!byCin7.has(r.cin7_id)) byCin7.set(r.cin7_id, []);
        byCin7.get(r.cin7_id)!.push(r);
      }

      let prodsAdded = 0; let prodsUpdated = 0;
      let varsAdded = 0;  let varsUpdated = 0;

      for (const [cin7Id, productRows] of byCin7) {
        const first = productRows[0];
        const supplierContactId = first.supplier_id ? (supplierMap.get(first.supplier_id) ?? null) : null;

        let productId: string;
        if (prodMap.has(cin7Id)) {
          productId = prodMap.get(cin7Id)!;
          await imsExecute(
            `UPDATE ims_products
             SET name=?, brand=?, style_code=?, is_online=?, supplier_contact_id=COALESCE(supplier_contact_id,?)
             WHERE cin7_product_id=?`,
            [first.name?.trim() || 'Unknown', first.brand || null,
             first.style_code || null, first.online ?? 1,
             supplierContactId, cin7Id],
          );
          prodsUpdated++;
        } else {
          productId = uuidv4();
          await imsExecute(
            `INSERT INTO ims_products (product_id,name,brand,style_code,is_online,supplier_contact_id,is_active,cin7_product_id)
             VALUES (?,?,?,?,?,?,1,?)`,
            [productId, first.name?.trim() || 'Unknown', first.brand || null,
             first.style_code || null, first.online ?? 1,
             supplierContactId, cin7Id],
          );
          prodMap.set(cin7Id, productId);
          prodsAdded++;
        }

        // Upsert variants
        for (const r of productRows) {
          if (!r.option_id) continue;
          // Prefer SKU lookup to handle size-grid products (shared cin7_option_id)
          const existingId = (r.code ? variantBySkuMap.get(r.code) : undefined) ?? variantMap.get(r.option_id);
          if (existingId) {
            await imsExecute(
              `UPDATE ims_product_variants
               SET product_id=?, sku=?, barcode=?, option1_name=?, option1_value=?, cost=?, price=?, pack_size=?
               WHERE variant_id=?`,
              [productId, r.code || null, r.barcode || null,
               r.option_label ? 'Option' : null, r.option_label || null,
               r.cost ?? null, r.retail_price ?? null, r.pack_size ?? null, existingId],
            );
            varsUpdated++;
          } else {
            const variantId = uuidv4();
            await imsExecute(
              `INSERT INTO ims_product_variants
                 (variant_id,product_id,sku,barcode,option1_name,option1_value,cost,price,is_active,cin7_option_id,pack_size)
               VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
              [variantId, productId, r.code || null, r.barcode || null,
               r.option_label ? 'Option' : null, r.option_label || null,
               r.cost ?? null, r.retail_price ?? null, r.option_id, r.pack_size ?? null],
            );
            if (r.code) variantBySkuMap.set(r.code, variantId);
            variantMap.set(r.option_id, variantId);
            varsAdded++;
          }
        }
      }

      send({
        status: 'done',
        prodsAdded, prodsUpdated, varsAdded, varsUpdated,
        message: `Done — ${prodsAdded} products added, ${prodsUpdated} updated. ${varsAdded} variants added, ${varsUpdated} updated.`,
      });
    } finally {
      await conn.end().catch(() => {});
    }
  });
}
