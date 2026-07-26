import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

const APPLY = process.argv.includes('--apply');
const HARD_DELETE = process.argv.includes('--hard-delete');
const argBusinessId = process.argv.find((a) => a.startsWith('--business-id='))?.split('=')[1] || '';
const argBusinessName = process.argv.find((a) => a.startsWith('--business-name='))?.split('=')[1] || 'Monsterthreads';

async function openMainDb() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
}

async function openImsDb(imsDbName) {
  return mysql.createConnection({
    host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.IMS_MYSQL_USER || process.env.MYSQL_USER,
    password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
    database: imsDbName,
  });
}

async function resolveBusiness(mainDb) {
  if (argBusinessId) {
    const [rows] = await mainDb.execute(
      'SELECT business_id, name, ims_db_name FROM businesses WHERE business_id = ? LIMIT 1',
      [argBusinessId],
    );
    return rows[0] || null;
  }
  const [rows] = await mainDb.execute(
    'SELECT business_id, name, ims_db_name FROM businesses WHERE LOWER(name) = LOWER(?) LIMIT 1',
    [argBusinessName],
  );
  return rows[0] || null;
}

async function getLock(conn, key, seconds) {
  const [rows] = await conn.execute('SELECT GET_LOCK(?, ?) AS got_lock', [key, seconds]);
  return Number(rows[0]?.got_lock || 0) === 1;
}

async function releaseLock(conn, key) {
  await conn.execute('SELECT RELEASE_LOCK(?)', [key]).catch(() => {});
}

async function run() {
  const mainDb = await openMainDb();
  try {
    const business = await resolveBusiness(mainDb);
    if (!business) {
      throw new Error(`Business not found. Use --business-id=<id> or --business-name=<name>`);
    }

    const businessId = business.business_id;
    const imsDbName = business.ims_db_name || process.env.IMS_MYSQL_DATABASE;
    if (!imsDbName) throw new Error('No ims_db_name resolved for business');

    const imsDb = await openImsDb(imsDbName);
    const lockKey = `shopify_fallback:${businessId}`;
    const gotLock = await getLock(imsDb, lockKey, 10);
    if (!gotLock) throw new Error('Could not acquire fallback lock');

    try {
      const [products] = await imsDb.execute(
        `SELECT id, product_id, name, base_sku, is_active, created_at
           FROM ims_products
          WHERE business_id = ? AND UPPER(COALESCE(base_sku, '')) = 'SHOPIFY-MISC'
          ORDER BY created_at ASC, id ASC`,
        [businessId],
      );

      const [variants] = await imsDb.execute(
        `SELECT v.id, v.variant_id, v.product_id, v.sku, v.is_active, v.created_at
           FROM ims_product_variants v
           JOIN ims_products p ON p.product_id = v.product_id
          WHERE p.business_id = ? AND UPPER(COALESCE(v.sku, '')) = 'SHOPIFY-MISC'
          ORDER BY v.created_at ASC, v.id ASC`,
        [businessId],
      );

      const canonicalProduct = products[0] || null;
      const canonicalVariant = variants[0] || null;
      const duplicateProducts = canonicalProduct ? products.slice(1) : products;
      const duplicateVariants = canonicalVariant ? variants.slice(1) : variants;

      const report = {
        businessId,
        businessName: business.name,
        imsDbName,
        hardDeleteMode: HARD_DELETE,
        fallbackProducts: products.length,
        fallbackVariants: variants.length,
        canonicalProductId: canonicalProduct?.product_id || null,
        canonicalVariantId: canonicalVariant?.variant_id || null,
        duplicateProducts: duplicateProducts.length,
        duplicateVariants: duplicateVariants.length,
        createdVariantId: null,
      };

      console.log('Dry-run report:');
      console.table([report]);

      if (!APPLY) {
        console.log('No changes applied. Re-run with --apply to execute cleanup. Add --hard-delete to physically delete safe duplicate products.');
        return;
      }

      await imsDb.beginTransaction();

      let productIdToUse = canonicalProduct?.product_id || null;
      if (!productIdToUse) {
        productIdToUse = randomUUID();
        await imsDb.execute(
          `INSERT INTO ims_products
             (business_id, product_id, name, description, product_type, category, base_sku, is_online, is_active)
           VALUES (?, ?, 'Shopify Misc Charge', 'Fallback product for Shopify order lines without a matched IMS variant.', 'service', 'Shopify Fallback', 'SHOPIFY-MISC', 1, 1)`,
          [businessId, productIdToUse],
        );
      }

      let variantIdToUse = canonicalVariant?.variant_id || null;
      if (!variantIdToUse) {
        variantIdToUse = randomUUID();
        await imsDb.execute(
          `INSERT INTO ims_product_variants
             (business_id, variant_id, product_id, sku, option1_name, option1_value, cost_aud, price_rrp, price_wholesale, is_active)
           VALUES (?, ?, ?, 'SHOPIFY-MISC', 'Type', 'Fallback', 0, 0, 0, 1)`,
          [businessId, variantIdToUse, productIdToUse],
        );
        report.createdVariantId = variantIdToUse;
      }

      await imsDb.execute(
        `INSERT INTO ims_settings (business_id, \`key\`, value)
         VALUES (?, 'shopify_fallback_variant_id', ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [businessId, variantIdToUse],
      );

      if (duplicateProducts.length > 0) {
        const productIds = duplicateProducts.map((p) => p.product_id);
        const placeholders = productIds.map(() => '?').join(',');

        if (HARD_DELETE) {
          // Physically delete only duplicate fallback products that have no
          // variants attached. This keeps destructive cleanup safe.
          await imsDb.execute(
            `DELETE p
               FROM ims_products p
               LEFT JOIN ims_product_variants v ON v.product_id = p.product_id
              WHERE p.business_id = ?
                AND p.product_id IN (${placeholders})
                AND v.product_id IS NULL`,
            [businessId, ...productIds],
          );
        }

        // Any duplicates not physically removed are soft-disabled.
        await imsDb.execute(
          `UPDATE ims_products
              SET is_active = 0,
                  is_online = 0,
                  updated_at = CURRENT_TIMESTAMP
            WHERE business_id = ? AND product_id IN (${placeholders})`,
          [businessId, ...productIds],
        );
      }

      if (duplicateVariants.length > 0) {
        const variantIds = duplicateVariants.map((v) => v.variant_id);
        const placeholders = variantIds.map(() => '?').join(',');
        await imsDb.execute(
          `UPDATE ims_product_variants
              SET is_active = 0,
                  updated_at = CURRENT_TIMESTAMP
            WHERE business_id = ? AND variant_id IN (${placeholders})`,
          [businessId, ...variantIds],
        );
      }

      await imsDb.commit();

      const [postProducts] = await imsDb.execute(
        `SELECT COUNT(*) AS c
           FROM ims_products
          WHERE business_id = ?
            AND UPPER(COALESCE(base_sku, '')) = 'SHOPIFY-MISC'
            AND is_active = 1`,
        [businessId],
      );
      const [postVariants] = await imsDb.execute(
        `SELECT COUNT(*) AS c
           FROM ims_product_variants v
           JOIN ims_products p ON p.product_id = v.product_id
          WHERE p.business_id = ?
            AND UPPER(COALESCE(v.sku, '')) = 'SHOPIFY-MISC'
            AND v.is_active = 1`,
        [businessId],
      );

      const [postProductsTotal] = await imsDb.execute(
        `SELECT COUNT(*) AS c
           FROM ims_products
          WHERE business_id = ?
            AND UPPER(COALESCE(base_sku, '')) = 'SHOPIFY-MISC'`,
        [businessId],
      );

      console.log('Cleanup applied. Active fallback rows after cleanup:');
      console.table([
        {
          totalFallbackProducts: Number(postProductsTotal[0]?.c || 0),
          activeFallbackProducts: Number(postProducts[0]?.c || 0),
          activeFallbackVariants: Number(postVariants[0]?.c || 0),
          fallbackVariantId: variantIdToUse,
        },
      ]);
    } finally {
      await releaseLock(imsDb, lockKey);
      await imsDb.end();
    }
  } finally {
    await mainDb.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
