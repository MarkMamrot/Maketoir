import 'dotenv/config';

import mysql from 'mysql2/promise';

import { channelProductPublicationAdapter } from '@/lib/channels/channelProductPublicationAdapters';
import { syncChannelProductPublications } from '@/lib/channels/channelProductPublication';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

const productId = 'fa529478-90e5-4809-a8d7-21a35c0c8e8b';
const channelInstanceId = '43e53831-ad2c-4bc7-9bd2-d443974a3b45';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [businessRows] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT business_id FROM businesses WHERE name = 'Monsterthreads' AND deleted_at IS NULL LIMIT 1`,
  );
  const businessId = String(businessRows[0]?.business_id ?? '').trim();
  if (!businessId) throw new Error('Monsterthreads business was not found.');

  const publication = await syncChannelProductPublications({
    businessId,
    channelInstanceId,
    provider: 'shopify',
    adapter: channelProductPublicationAdapter('shopify'),
    productIds: [productId],
    limit: 1,
  });
  if (publication.applied !== 1 || publication.blocked !== 0 || publication.failed !== 0) {
    throw new Error(`Publication did not apply cleanly: ${JSON.stringify(publication)}`);
  }

  const verification = await runImsForBusiness(businessId, async () => {
    const assignments = await imsQuery<{
      desired_state: string;
      provider_state: string;
      readiness_status: string;
      external_product_id: string | null;
      last_submitted_at: Date | string | null;
      last_observed_at: Date | string | null;
    }>(
      `SELECT desired_state, provider_state, readiness_status, external_product_id,
              last_submitted_at, last_observed_at
         FROM ims_sales_channel_product_assignments
        WHERE business_id = ? AND channel_instance_id = ? AND product_id = ? LIMIT 1`,
      [businessId, channelInstanceId, productId],
    );
    const mappings = await imsQuery<{
      variant_id: string;
      external_product_id: string;
      external_variant_id: string;
      external_inventory_id: string | null;
      mapping_status: string;
    }>(
      `SELECT mapping.variant_id, mapping.external_product_id, mapping.external_variant_id,
              mapping.external_inventory_id, mapping.mapping_status
         FROM ims_sales_channel_product_mappings mapping
         JOIN ims_product_variants variant
           ON BINARY variant.business_id = BINARY mapping.business_id
          AND BINARY variant.variant_id = BINARY mapping.variant_id
        WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND variant.product_id = ?`,
      [businessId, channelInstanceId, productId],
    );
    const assignment = assignments[0];
    if (!assignment?.external_product_id) throw new Error('Publication completed without an external Shopify product ID.');

    const { credentials } = await getShopifyOperationContext({ businessId, channelInstanceId });
    const shopifyProduct = await new ShopifyService(credentials.shopDomain, credentials.token)
      .getProduct(assignment.external_product_id);
    return {
      assignment,
      mappings,
      shopify: {
        id: String(shopifyProduct.id),
        title: shopifyProduct.title,
        handle: shopifyProduct.handle,
        status: shopifyProduct.status,
        variantCount: shopifyProduct.variants?.length ?? 0,
        imageCount: shopifyProduct.images?.length ?? 0,
        adminUrl: `https://${credentials.shopDomain}/admin/products/${shopifyProduct.id}`,
        productUrl: `https://${credentials.shopDomain}/products/${shopifyProduct.handle}`,
      },
    };
  });

  if (verification.assignment.provider_state !== 'published' || verification.shopify.status !== 'active') {
    throw new Error(`Publication verification failed: ${JSON.stringify(verification)}`);
  }
  console.log(JSON.stringify({ businessId, productId, channelInstanceId, publication, verification }, null, 2));
} finally {
  await connection.end();
}