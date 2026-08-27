import 'dotenv/config';

import { ConnectionsRepository } from '../src/lib/db/ConnectionsRepository';
import { decrypt } from '../src/lib/encryption';
import { ShopifyService } from '../src/services/ShopifyService';

const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

async function main() {
  const connection = await ConnectionsRepository.get(businessId);
  if (!connection?.shopify_shop_id || !connection.shopify_access_token) throw new Error('Shopify connection missing.');
  let token = connection.shopify_access_token;
  try { token = decrypt(token); } catch { /* unencrypted legacy token */ }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => originalFetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
  const shopify = new ShopifyService(connection.shopify_shop_id, token);
  const history = await shopify.getGiftCardTransactions('559460974808');
  console.log(JSON.stringify({ balance: history.balance, transactionCount: history.transactions.length }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
