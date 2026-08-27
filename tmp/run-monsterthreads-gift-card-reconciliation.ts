import 'dotenv/config';

import { runImsForBusiness } from '../src/lib/db/BusinessRegistry';
import { ConnectionsRepository } from '../src/lib/db/ConnectionsRepository';
import { decrypt } from '../src/lib/encryption';
import { syncShopifyGiftCardSnapshots } from '../src/lib/ims/shopifyGiftCardSync';
import { ShopifyService } from '../src/services/ShopifyService';

const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

async function main() {
  const connection = await ConnectionsRepository.get(businessId);
  if (!connection?.shopify_shop_id || !connection.shopify_access_token) {
    throw new Error('Monsterthreads Shopify connection is not configured.');
  }
  let token = connection.shopify_access_token;
  try { token = decrypt(token); } catch { /* unencrypted legacy token */ }

  const result = await runImsForBusiness(businessId, () =>
    syncShopifyGiftCardSnapshots(
      businessId,
      new ShopifyService(connection.shopify_shop_id!, token),
    ),
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
