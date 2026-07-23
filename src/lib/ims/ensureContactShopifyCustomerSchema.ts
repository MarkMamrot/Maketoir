import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

let ensurePromise: Promise<void> | null = null;

export function ensureContactShopifyCustomerSchema() {
  if (!ensurePromise) ensurePromise = runEnsure();
  return ensurePromise;
}

async function runEnsure() {
  const cols = await imsQuery<{ Field: string }>('SHOW COLUMNS FROM ims_contacts').catch(() => [] as { Field: string }[]);
  const colSet = new Set(cols.map(c => c.Field));

  if (!colSet.has('shopify_customer_id')) {
    await imsExecute('ALTER TABLE ims_contacts ADD COLUMN shopify_customer_id VARCHAR(100) DEFAULT NULL').catch(() => {});
  }

  const indexes = await imsQuery<{ Key_name: string }>('SHOW INDEX FROM ims_contacts').catch(() => [] as { Key_name: string }[]);
  const indexSet = new Set(indexes.map(i => i.Key_name));
  if (!indexSet.has('idx_shopify_customer_id')) {
    await imsExecute('ALTER TABLE ims_contacts ADD UNIQUE INDEX idx_shopify_customer_id (business_id, shopify_customer_id)').catch(() => {});
  }
}