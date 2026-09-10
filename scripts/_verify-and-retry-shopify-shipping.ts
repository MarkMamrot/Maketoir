import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const shipmentIds = [5, 6, 7];
const requiredScopes = [
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
];

async function main() {
  const { runImsForBusiness } = await import('../src/lib/db/BusinessRegistry');
  const { dispatchShippingShipment } = await import('../src/lib/ims/shipping/shippingDispatch');
  const { getShopifyAdminCredentials } = await import('../src/lib/shopifyCredentials');
  const credentials = await getShopifyAdminCredentials(businessId);
  if (!credentials) throw new Error('Shopify credentials are unavailable.');
  const scopeResponse = await fetch(`https://${credentials.shopDomain}/admin/oauth/access_scopes.json`, {
    headers: { 'X-Shopify-Access-Token': credentials.token },
    cache: 'no-store',
  });
  const scopePayload = await scopeResponse.json();
  const scopes = new Set<string>((scopePayload?.access_scopes ?? []).map((scope: { handle?: string }) => String(scope.handle || '')));
  const missingScopes = requiredScopes.filter(scope => !scopes.has(scope));
  console.log(JSON.stringify({ scopeStatus: scopeResponse.status, requiredScopesPresent: missingScopes.length === 0, missingScopes }));
  if (missingScopes.length) return;

  await runImsForBusiness(businessId, async () => {
    for (const shipmentId of shipmentIds) {
      try {
        const result = await dispatchShippingShipment({ businessId, shipmentId });
        console.log(JSON.stringify({ shipmentId, success: true, result }));
      } catch (error) {
        console.log(JSON.stringify({ shipmentId, success: false, error: error instanceof Error ? error.message : String(error) }));
      }
    }
  });
 }
 
void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
