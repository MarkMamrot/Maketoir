require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const READ_BATCH_SIZE = 100;
const WRITE_BATCH_SIZE = 100;

function config(database) {
  return { host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database, connectTimeout: 20_000 };
}
function decrypt(value) {
  if (!value) return '';
  const parts = String(value).split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return String(value);
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be a 32-byte hex key.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
}
async function tokenFor(connection) {
  if (connection.shopify_auth_mode !== 'client_credentials') return decrypt(connection.shopify_access_token).trim();
  const cached = decrypt(connection.shopify_access_token).trim();
  if (cached && Number(connection.shopify_token_expires_at || 0) > Date.now() + 300_000) return cached;
  const domain = String(connection.shopify_shop_id).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const response = await fetch(`https://${domain}/admin/oauth/access_token`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: String(connection.shopify_client_id || '').trim(),
      client_secret: decrypt(connection.shopify_client_secret).trim(),
    }) });
  if (!response.ok) throw new Error(`Shopify token request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Shopify token response did not contain an access token.');
  return payload.access_token;
}
async function graphql(domain, token, query, variables) {
  const response = await fetch(`https://${domain}/admin/api/2025-10/graphql.json`, { method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Shopify GraphQL HTTP ${response.status}: ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  if (payload.errors?.length) throw new Error(`Shopify GraphQL: ${payload.errors.map(error => error.message).join('; ')}`);
  return payload.data;
}
const idNumber = gid => String(gid || '').split('/').pop() || '';

async function main() {
  const mainDb = await mysql.createConnection(config(process.env.MYSQL_DATABASE));
  let ims;
  try {
    const [businesses] = await mainDb.execute(`SELECT business_id, ims_db_name FROM businesses
      WHERE (LOWER(name) LIKE ? OR LOWER(ims_db_name) LIKE ?) AND deleted_at IS NULL`, ['%sage%', '%sage%']);
    if (businesses.length !== 1) throw new Error(`Expected one Sage business, found ${businesses.length}.`);
    const business = businesses[0];
    const [connections] = await mainDb.execute(`SELECT shopify_shop_id, shopify_access_token, shopify_auth_mode,
      shopify_client_id, shopify_client_secret, shopify_token_expires_at FROM connections WHERE business_id = ? LIMIT 1`,
      [business.business_id]);
    if (!connections[0]?.shopify_shop_id) throw new Error('Sage Shopify connection was not found.');
    const domain = String(connections[0].shopify_shop_id).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const token = await tokenFor(connections[0]);
    ims = await mysql.createConnection(config(business.ims_db_name));
    const [local] = await ims.execute(`SELECT p.product_id, p.name, p.shopify_product_id,
      v.variant_id, v.sku, v.shopify_variant_id, v.shopify_inventory_item_id
      FROM ims_products p JOIN ims_product_variants v ON v.product_id = p.product_id AND v.business_id = p.business_id
      WHERE p.business_id = ? AND p.is_active = 1 AND v.is_active = 1
        AND p.shopify_product_id IS NOT NULL AND p.shopify_product_id <> ''
        AND v.shopify_variant_id IS NOT NULL AND v.shopify_variant_id <> ''
      ORDER BY p.product_id, v.id`, [business.business_id]);
    await ims.end(); ims = null;
    const blankLocal = local.filter(row => !String(row.sku || '').trim());
    if (blankLocal.length) throw new Error(`${blankLocal.length} active linked Solvantis variants have blank SKUs.`);
    const localSkuCounts = new Map();
    for (const row of local) {
      const key = String(row.sku).trim().toLowerCase();
      localSkuCounts.set(key, (localSkuCounts.get(key) || 0) + 1);
    }
    const duplicateLocal = [...localSkuCounts.entries()].filter(([, count]) => count > 1);
    if (duplicateLocal.length) throw new Error(`${duplicateLocal.length} duplicate active Solvantis SKU values found.`);

    const remoteById = new Map();
    const readQuery = `query ReadVariants($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant { id sku product { id } inventoryItem { id } }
      }
    }`;
    for (let offset = 0; offset < local.length; offset += READ_BATCH_SIZE) {
      const batch = local.slice(offset, offset + READ_BATCH_SIZE);
      const data = await graphql(domain, token, readQuery, { ids: batch.map(row => `gid://shopify/ProductVariant/${row.shopify_variant_id}`) });
      for (const node of data.nodes || []) if (node?.id) remoteById.set(idNumber(node.id), node);
      if ((offset + batch.length) % 500 === 0 || offset + batch.length === local.length) {
        console.error(`Read ${offset + batch.length}/${local.length} linked Shopify variants`);
      }
    }

    const missingRemote = [];
    const parentMismatches = [];
    const inventoryItemMismatches = [];
    const differences = [];
    for (const row of local) {
      const remote = remoteById.get(String(row.shopify_variant_id));
      if (!remote) { missingRemote.push(row); continue; }
      if (idNumber(remote.product?.id) !== String(row.shopify_product_id)) parentMismatches.push(row);
      if (String(row.shopify_inventory_item_id || '') !== idNumber(remote.inventoryItem?.id)) inventoryItemMismatches.push(row);
      const localSku = String(row.sku).trim();
      const remoteSku = String(remote.sku || '').trim();
      if (localSku !== remoteSku) differences.push({ ...row, localSku, remoteSku });
    }
    const groups = new Map();
    for (const row of differences) {
      const group = groups.get(String(row.shopify_product_id)) || [];
      group.push(row); groups.set(String(row.shopify_product_id), group);
    }
    const summary = {
      mode: APPLY ? 'apply' : 'dry-run', linkedVariants: local.length, linkedProducts: new Set(local.map(row => row.product_id)).size,
      missingRemote: missingRemote.length, parentMismatches: parentMismatches.length,
      inventoryItemMismatches: inventoryItemMismatches.length, skuDifferences: differences.length,
      affectedProducts: groups.size, remoteBlankDifferences: differences.filter(row => !row.remoteSku).length,
      remoteNonblankDifferences: differences.filter(row => !!row.remoteSku).length,
      samples: differences.slice(0, 20).map(row => ({ product: row.name, shopifyVariantId: String(row.shopify_variant_id),
        solvantisSku: row.localSku, shopifySku: row.remoteSku || null })),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (missingRemote.length || parentMismatches.length || inventoryItemMismatches.length) {
      throw new Error('Link validation failed; refusing to update Shopify SKUs.');
    }
    if (!APPLY || !differences.length) return;

    const mutation = `mutation UpdateVariantSkus($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id sku }
        userErrors { field message }
      }
    }`;
    let updated = 0;
    for (const [shopifyProductId, rows] of groups) {
      for (let offset = 0; offset < rows.length; offset += WRITE_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + WRITE_BATCH_SIZE);
        const data = await graphql(domain, token, mutation, {
          productId: `gid://shopify/Product/${shopifyProductId}`,
          variants: batch.map(row => ({
            id: `gid://shopify/ProductVariant/${row.shopify_variant_id}`,
            inventoryItem: { sku: row.localSku },
          })),
        });
        const result = data.productVariantsBulkUpdate;
        if (result.userErrors?.length) throw new Error(`Shopify rejected SKU update: ${result.userErrors.map(error => `${error.field?.join('.') || 'variant'}: ${error.message}`).join('; ')}`);
        const returned = new Map((result.productVariants || []).map(variant => [idNumber(variant.id), String(variant.sku || '')]));
        for (const row of batch) {
          if (returned.get(String(row.shopify_variant_id)) !== row.localSku) throw new Error(`Shopify did not confirm SKU for variant ${row.shopify_variant_id}.`);
        }
        updated += batch.length;
      }
      if (updated % 100 < rows.length || updated === differences.length) console.error(`Updated ${updated}/${differences.length} Shopify variant SKUs`);
    }

    let verificationMismatches = 0;
    const differenceIds = differences.map(row => String(row.shopify_variant_id));
    for (let offset = 0; offset < differences.length; offset += READ_BATCH_SIZE) {
      const batch = differences.slice(offset, offset + READ_BATCH_SIZE);
      const data = await graphql(domain, token, readQuery, { ids: batch.map(row => `gid://shopify/ProductVariant/${row.shopify_variant_id}`) });
      const readback = new Map((data.nodes || []).filter(Boolean).map(node => [idNumber(node.id), String(node.sku || '')]));
      for (const row of batch) if (readback.get(String(row.shopify_variant_id)) !== row.localSku) verificationMismatches += 1;
    }
    console.log(JSON.stringify({ applied: true, updated, requestedVariantIds: differenceIds.length,
      verificationMismatches, exactMatch: verificationMismatches === 0 }, null, 2));
    if (verificationMismatches) throw new Error(`${verificationMismatches} SKU updates failed readback verification.`);
  } finally { if (ims) await ims.end(); await mainDb.end(); }
}
main().catch(error => { console.error(error.message); process.exit(1); });
