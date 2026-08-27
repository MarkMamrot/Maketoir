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
  let requestCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/gift_cards.json')) {
      requestCount += 1;
      console.log(`${requestCount}: status=${url.searchParams.get('status')} page=${url.searchParams.get('page_info')?.slice(0, 12) ?? 'first'}`);
      if (requestCount > 12) throw new Error('Gift-card pagination exceeded the expected page count.');
    }
    return originalFetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
  };

  const shopify = new ShopifyService(connection.shopify_shop_id, token);
  const [enabled, disabled] = await Promise.all([
    shopify.getAllGiftCards('enabled'),
    shopify.getAllGiftCards('disabled'),
  ]);
  console.log(JSON.stringify({ enabled: enabled.length, disabled: disabled.length, requestCount }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
