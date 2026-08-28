require('dotenv').config({ quiet: true });
const { createDecipheriv } = require('crypto');
const mysql = require('mysql2/promise');
const Shopify = require('shopify-api-node');

const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

function decrypt(stored) {
  if (!stored) return '';
  const parts = String(stored).split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return String(stored);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(process.env.ENCRYPTION_KEY, 'hex'), Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
}

(async () => {
  const csvProducts = await new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => {
      try { resolve(input.trim() ? JSON.parse(input) : []); } catch (error) { reject(error); }
    });
    process.stdin.on('error', reject);
  });

  const main = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const [businesses] = await main.execute(
    `SELECT business_id, ims_db_name FROM businesses
      WHERE (LOWER(name) LIKE ? OR LOWER(ims_db_name) LIKE ?) AND deleted_at IS NULL`,
    ['%sage%', '%sage%'],
  );
  if (businesses.length !== 1) throw new Error(`Expected one Sage business, found ${businesses.length}.`);
  const [connections] = await main.execute(
    `SELECT shopify_shop_id, shopify_auth_mode, shopify_access_token, shopify_client_id,
            shopify_client_secret, shopify_token_expires_at
       FROM connections WHERE business_id = ?`,
    [businesses[0].business_id],
  );
  await main.end();
  if (connections.length !== 1) throw new Error('Sage Shopify connection was not found.');

  const connection = connections[0];
  const shopDomain = String(connection.shopify_shop_id || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/+$/, '');
  let token = decrypt(connection.shopify_access_token).trim();
  const tokenExpiresAt = Number(connection.shopify_token_expires_at || 0);
  if (connection.shopify_auth_mode === 'client_credentials' && (!token || tokenExpiresAt <= Date.now() + 60_000)) {
    const tokenResponse = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: String(connection.shopify_client_id || ''),
        client_secret: decrypt(connection.shopify_client_secret).trim(),
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Shopify token request failed with HTTP ${tokenResponse.status}.`);
    token = String((await tokenResponse.json()).access_token || '');
  }

  const shopify = new Shopify({ shopName: shopDomain.replace(/\.myshopify\.com$/, ''), accessToken: token });
  const shopifyProducts = [];
  let productParams = { limit: 25, status: 'active' };
  while (productParams) {
    const page = await shopify.product.list(productParams);
    shopifyProducts.push(...page);
    const pageInfo = String(page.nextPageParameters?.page_info || '').trim();
    productParams = pageInfo ? { limit: 25, page_info: pageInfo } : null;
  }

  const tenant = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: businesses[0].ims_db_name,
  });
  const [products] = await tenant.execute(
    `SELECT product_id, name, shopify_product_id FROM ims_products WHERE business_id = ? ORDER BY name`,
    [businesses[0].business_id],
  );
  const [variants] = await tenant.execute(
    `SELECT variant_id, product_id, shopify_variant_id
       FROM ims_product_variants WHERE business_id = ? AND shopify_variant_id IS NOT NULL AND shopify_variant_id <> ''`,
    [businesses[0].business_id],
  );
  const [logs] = await tenant.execute(
    `SELECT created_at, status, summary, detail
       FROM ims_shopify_sync_log
      WHERE business_id = ? AND action = 'reconcile'
      ORDER BY created_at DESC LIMIT 100`,
    [businesses[0].business_id],
  );
  await tenant.end();

  const sageTitles = new Set(products.map(product => normalize(product.name)));
  const titleMissing = csvProducts.filter(product => !sageTitles.has(normalize(product.title)));
  const parsedLogs = logs.map(log => {
    let detail = null;
    try { detail = typeof log.detail === 'string' ? JSON.parse(log.detail) : log.detail; } catch {}
    return { createdAt: log.created_at, status: log.status, summary: log.summary, detail };
  });
  const recentImportLogs = parsedLogs.filter(log => log.summary?.startsWith('Imported Shopify catalogue batch:'));
  const warnings = recentImportLogs.flatMap(log => Array.isArray(log.detail?.warnings) ? log.detail.warnings : []);

  const runs = [];
  for (const log of recentImportLogs) {
    const createdAt = new Date(log.createdAt).getTime();
    const latestRun = runs[runs.length - 1];
    if (!latestRun || latestRun.oldestAt - createdAt > 60_000) {
      runs.push({ newestAt: createdAt, oldestAt: createdAt, logs: [] });
    }
    const run = runs[runs.length - 1];
    run.oldestAt = createdAt;
    run.logs.push(log);
  }
  const importRuns = runs.map(run => ({
    startedAt: new Date(run.oldestAt).toISOString(),
    finishedAt: new Date(run.newestAt).toISOString(),
    batches: run.logs.length,
    createdProducts: run.logs.reduce((sum, log) => sum + Number(log.detail?.createdProducts || 0), 0),
    updatedProducts: run.logs.reduce((sum, log) => sum + Number(log.detail?.updatedProducts || 0), 0),
    warnings: run.logs.flatMap(log => Array.isArray(log.detail?.warnings) ? log.detail.warnings : []),
  }));
  const linkedShopifyIds = new Set(products.filter(product => product.shopify_product_id).map(product => String(product.shopify_product_id)));
  const liveMissing = shopifyProducts
    .filter(product => !linkedShopifyIds.has(String(product.id)))
    .map(product => ({ id: String(product.id), handle: product.handle, title: product.title, status: product.status }));
  const liveActiveProducts = shopifyProducts.filter(product => product.status === 'active');
  const liveActiveMissing = liveActiveProducts
    .filter(product => !linkedShopifyIds.has(String(product.id)))
    .map(product => ({ id: String(product.id), handle: product.handle, title: product.title }));
  const productById = new Map(products.map(product => [product.product_id, product]));
  const variantOwnerByShopifyId = new Map(variants.map(variant => [String(variant.shopify_variant_id), variant.product_id]));
  const missingOwnership = liveActiveProducts
    .filter(product => !linkedShopifyIds.has(String(product.id)))
    .map(product => {
      const ownerProductIds = [...new Set((product.variants || [])
        .map(variant => variantOwnerByShopifyId.get(String(variant.id)))
        .filter(Boolean))];
      return {
        id: String(product.id),
        handle: product.handle,
        title: product.title,
        ownerProductIds,
        ownerShopifyProductIds: ownerProductIds.map(productId => String(productById.get(productId)?.shopify_product_id || '')),
      };
    });
  const activeShopifyIds = new Set(liveActiveProducts.map(product => String(product.id)));
  const missingOwnershipCounts = {
    noVariantOwner: missingOwnership.filter(product => product.ownerProductIds.length === 0).length,
    oneVariantOwner: missingOwnership.filter(product => product.ownerProductIds.length === 1).length,
    multipleVariantOwners: missingOwnership.filter(product => product.ownerProductIds.length > 1).length,
    ownerCurrentlyLinkedToActive: missingOwnership.filter(product =>
      product.ownerShopifyProductIds.some(productId => activeShopifyIds.has(productId)),
    ).length,
  };

  if (process.argv.includes('--counts')) {
    console.log(JSON.stringify({
      csvProducts: csvProducts.length,
      sageProducts: products.length,
      uniqueShopifyProductIds: linkedShopifyIds.size,
      liveShopifyProducts: shopifyProducts.length,
      liveShopifyProductsByStatus: Object.fromEntries(['active', 'draft', 'archived'].map(status => [
        status,
        shopifyProducts.filter(product => product.status === status).length,
      ])),
      liveMissingCount: liveMissing.length,
      liveActiveMissingCount: liveActiveMissing.length,
      missingOwnershipCounts,
      latestImportRun: importRuns[0],
    }));
    return;
  }

  if (process.argv.includes('--compact')) {
    console.log(JSON.stringify({
      csvProducts: csvProducts.length,
      sageProducts: products.length,
      linkedProducts: products.filter(product => product.shopify_product_id).length,
      uniqueShopifyProductIds: new Set(products.filter(product => product.shopify_product_id).map(product => String(product.shopify_product_id))).size,
      liveShopifyProducts: shopifyProducts.length,
      liveShopifyProductsByStatus: Object.fromEntries(['active', 'draft', 'archived'].map(status => [
        status,
        shopifyProducts.filter(product => product.status === status).length,
      ])),
      liveMissingCount: liveMissing.length,
      liveActiveProducts: liveActiveProducts.length,
      liveActiveMissingCount: liveActiveMissing.length,
      liveActiveMissing,
      unlinkedProducts: products.filter(product => !product.shopify_product_id).map(product => product.name),
      titleMissingCount: titleMissing.length,
      titleMissing: titleMissing.slice(0, 100),
      importRuns,
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    csvProducts: csvProducts.length,
    sageProducts: products.length,
    linkedProducts: products.filter(product => product.shopify_product_id).length,
    uniqueShopifyProductIds: new Set(products.filter(product => product.shopify_product_id).map(product => String(product.shopify_product_id))).size,
    unlinkedProducts: products.filter(product => !product.shopify_product_id).map(product => product.name),
    titleMissingCount: titleMissing.length,
    titleMissing: titleMissing.slice(0, 100),
    recentImportBatchCount: recentImportLogs.length,
    recentWarningsCount: warnings.length,
    recentWarnings: warnings.slice(0, 100),
    recentBatches: recentImportLogs.slice(0, 50).map(log => ({ createdAt: log.createdAt, status: log.status, summary: log.summary, detail: log.detail })),
  }, null, 2));
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});