require('dotenv').config({ quiet: true });
require('tsx/cjs');
const crypto = require('crypto');
const { query, getPool } = require('../src/services/MySQLService.ts');
const { runImsForBusiness } = require('../src/lib/db/BusinessRegistry.ts');
const { imsQuery, imsExecute, getIMSPool } = require('../src/services/IMSMySQLService.ts');
const { getShopifyOperationContext } = require('../src/lib/channels/shopifyOperationContext.ts');
const { recordInboundContactChannelMapping } = require('../src/lib/ims/contactChannelMappings.ts');
const { buildShopifyCustomerPayload } = require('../src/lib/ims/shopifyCustomerSync.ts');
const { ShopifyLoyaltyMetafieldService } = require('../src/lib/loyalty/ShopifyLoyaltyMetafieldService.ts');
const { ShopifyService } = require('../src/services/ShopifyService.ts');
const { reportRuntimeIssue } = require('../src/lib/runtimeIssues.ts');

const newCustomerIds = [85618, 85630, 85663, 85670, 85746];
const loyaltyIds = [26423, 25818, 46165, 72752, 12853, 85694, 63826, 731, 71489];
const allIds = [...newCustomerIds, ...loyaltyIds];
const channelInstanceId = '43e53831-ad2c-4bc7-9bd2-d443974a3b45';
const apply = process.argv.includes('--apply');
const originalFetch = global.fetch;
global.fetch = (resource, options = {}) => originalFetch(resource, {
  ...options,
  signal: AbortSignal.any([AbortSignal.timeout(15000), ...(options.signal ? [options.signal] : [])]),
});
const deadline = setTimeout(() => {
  console.error('Stopped at 180-second deadline. Do not assume remaining contacts were repaired.');
  process.exit(2);
}, 180000);
let business;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function snapshot() {
  const placeholders = allIds.map(() => '?').join(',');
  const accounts = await imsQuery(`SELECT * FROM loyalty_accounts WHERE business_id=? AND contact_id IN (${placeholders}) ORDER BY id`, [business.business_id, ...allIds]);
  const transactions = await imsQuery(`SELECT t.* FROM loyalty_transactions t JOIN loyalty_accounts a ON a.id=t.account_id AND BINARY a.business_id=BINARY t.business_id WHERE t.business_id=? AND a.contact_id IN (${placeholders}) ORDER BY t.id`, [business.business_id, ...allIds]);
  const redemptions = await imsQuery(`SELECT r.* FROM loyalty_redemptions r JOIN loyalty_accounts a ON a.id=r.account_id AND BINARY a.business_id=BINARY r.business_id WHERE r.business_id=? AND a.contact_id IN (${placeholders}) ORDER BY r.id`, [business.business_id, ...allIds]);
  const contacts = await imsQuery(`SELECT id,loyalty_member,store_credit FROM ims_contacts WHERE business_id=? AND id IN (${placeholders}) ORDER BY id`, [business.business_id, ...allIds]);
  return crypto.createHash('sha256').update(JSON.stringify({ accounts, transactions, redemptions, contacts })).digest('hex');
}

async function execute() {
  try {
    const businesses = await query('SELECT business_id,ims_db_name FROM businesses WHERE name=? AND is_sandbox=0 AND deleted_at IS NULL', ['Monsterthreads']);
    assert(businesses.length === 1, 'Ambiguous production business');
    business = businesses[0];
    await runImsForBusiness(business.business_id, async () => {
      const before = await snapshot();
      const { credentials } = await getShopifyOperationContext({ businessId: business.business_id, channelInstanceId });
      const baseUrl = `https://${credentials.shopDomain}`;
      const headers = { 'X-Shopify-Access-Token': credentials.token, Accept: 'application/json' };
      const scopeResponse = await fetch(`${baseUrl}/admin/oauth/access_scopes.json`, { headers });
      assert(scopeResponse.ok, `Scope check returned HTTP ${scopeResponse.status}`);
      const scopes = (await scopeResponse.json()).access_scopes?.map(scope => scope.handle) ?? [];
      assert(scopes.includes('read_customers') && scopes.includes('write_customers'), 'Customer permissions are not granted');
      const service = new ShopifyService(credentials.shopDomain, credentials.token);
      const plans = [];
      for (const contactId of allIds) {
        console.log(`Inspect contact ${contactId}`);
        const contacts = await imsQuery('SELECT id,type,is_active,name,first_name,last_name,email,phone,mobile,shopify_customer_id FROM ims_contacts WHERE business_id=? AND id=?', [business.business_id, contactId]);
        const contact = contacts[0];
        assert(contact?.is_active === 1, `Contact ${contactId} is not active`);
        const mappings = await imsQuery('SELECT external_customer_id,mapping_status FROM ims_contact_channel_mappings WHERE business_id=? AND channel_instance_id=? AND contact_id=?', [business.business_id, channelInstanceId, contactId]);
        assert(mappings.length <= 1 && (!mappings.length || mappings[0].mapping_status === 'linked'), `Contact ${contactId} has conflicting mappings`);
        let externalId = String(mappings[0]?.external_customer_id ?? '');
        let action = 'refresh_loyalty';
        if (!externalId) {
          assert(newCustomerIds.includes(contactId) && contact.type === 'retail_customer' && contact.email?.trim(), `Contact ${contactId} is not eligible for safe linking`);
          const matches = await service.findCustomersByExactEmail(contact.email);
          assert(matches.length <= 1, `Contact ${contactId} has multiple exact email matches`);
          externalId = matches[0] ? String(matches[0].id) : '';
          action = externalId ? 'link_existing' : 'create_missing';
          if (!externalId) {
            const duplicateContacts = await imsQuery('SELECT id FROM ims_contacts WHERE business_id=? AND id<>? AND is_active=1 AND LOWER(TRIM(email))=? LIMIT 1', [business.business_id, contactId, contact.email.trim().toLowerCase()]);
            assert(!duplicateContacts.length, `Contact ${contactId} shares an email with another active local contact; review required`);
          }
        }
        if (externalId) {
          const owners = await imsQuery('SELECT contact_id FROM ims_contact_channel_mappings WHERE business_id=? AND channel_instance_id=? AND external_customer_id=?', [business.business_id, channelInstanceId, externalId]);
          assert(owners.every(owner => Number(owner.contact_id) === contactId), `Shopify identity for ${contactId} belongs to another local contact`);
          const response = await fetch(`${baseUrl}/admin/api/2024-04/customers/${externalId}.json`, { headers });
          assert(response.ok, `Linked customer ${contactId} read returned HTTP ${response.status}`);
          const remote = (await response.json()).customer;
          assert(String(remote?.id) === externalId, `Customer identity for ${contactId} changed`);
        }
        plans.push({ contact, externalId, action });
        console.log(JSON.stringify({ contactId, action, externalCustomerId: externalId || null }));
      }
      if (!apply) {
        console.log('Dry run complete: no writes performed.');
        return;
      }
      const results = [];
      for (const plan of plans) {
        const contactId = plan.contact.id;
        console.log(`Repair contact ${contactId}: ${plan.action}`);
        let externalId = plan.externalId;
        if (plan.action === 'create_missing') {
          const matches = await service.findCustomersByExactEmail(plan.contact.email);
          assert(matches.length <= 1, `Contact ${contactId} matching became ambiguous`);
          externalId = matches[0] ? String(matches[0].id) : String((await service.createCustomer(buildShopifyCustomerPayload(plan.contact)))?.id ?? '');
          assert(externalId, `Create result missing customer identity for ${contactId}; check Shopify before another attempt`);
        }
        if (plan.action !== 'refresh_loyalty') {
          const mapping = await recordInboundContactChannelMapping({ businessId: business.business_id, channelInstanceId, contactId, externalCustomerId: externalId });
          assert(mapping.mappingStatus === 'linked' && mapping.contactId === contactId && mapping.externalCustomerId === externalId, `Mapping conflict for ${contactId}`);
          await imsExecute('UPDATE ims_contacts SET shopify_customer_id=? WHERE business_id=? AND id=? AND (shopify_customer_id IS NULL OR shopify_customer_id=?)', [externalId, business.business_id, contactId, externalId]);
        }
        const result = await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({ businessId: business.business_id, channelInstanceId, contactId });
        assert(result.status === 'synced' && result.shopifyCustomerId === externalId, `Loyalty refresh failed or skipped for ${contactId}`);
        const response = await fetch(`${baseUrl}/admin/api/2024-04/customers/${externalId}/metafields.json?namespace=solvantis_loyalty&limit=250`, { headers });
        assert(response.ok, `Metafield verification for ${contactId} returned HTTP ${response.status}`);
        const metafields = (await response.json()).metafields ?? [];
        const fields = Object.fromEntries(metafields.filter(field => field.namespace === 'solvantis_loyalty').map(field => [field.key, field.value]));
        const local = await imsQuery('SELECT loyalty_member FROM ims_contacts WHERE business_id=? AND id=?', [business.business_id, contactId]);
        assert(String(fields.member) === (local[0].loyalty_member ? 'true' : 'false') && Number(fields.balance_points) === result.balancePoints && fields.updated_at, `Metafield readback mismatch for ${contactId}`);
        results.push({ contactId, action: plan.action, externalCustomerId: externalId, verified: true });
        console.log(JSON.stringify(results[results.length - 1]));
      }
      assert(await snapshot() === before, 'Local loyalty ledger/membership/store-credit snapshot changed during repair; investigate concurrent activity before claiming unchanged');
      console.log(JSON.stringify({ repaired: results.length, local_loyalty_and_store_credit_unchanged: true, results }, null, 2));
    });
  } catch (error) {
    if (business) await reportRuntimeIssue({ businessId: business.business_id, source: 'support_reconciliation', operation: 'repair_shopify_customer_permissions', title: 'Retrospective Shopify customer repair stopped', error: new Error('Customer repair did not complete; review the affected contact and provider state before retrying.'), context: { apply, issueIds: [1122, 1090] } }).catch(() => {});
    throw error;
  } finally {
    if (business) await getIMSPool(business.ims_db_name).end();
    await getPool().end();
    global.fetch = originalFetch;
    clearTimeout(deadline);
  }
}

execute().catch(error => {
  console.error(error.name === 'HTTPError' ? 'Provider request failed; inspect before retrying.' : error.message);
  process.exitCode = 1;
});