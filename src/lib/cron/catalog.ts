export const CRON_JOBS = [
  { id: 'database-backup', name: 'Database backups', category: 'Maintenance', schedule: '0 3,15 * * *', workflow: 'backup.yml', path: '/api/admin/backup', method: 'POST', warning: 'Pausing backups removes scheduled recovery copies.' },
  { id: 'ai-billing-maintenance', name: 'AI billing maintenance', category: 'Maintenance', schedule: '29 * * * *', workflow: 'ai-billing-maintenance.yml', path: '/api/cron/ai-billing-maintenance', method: 'GET', warning: 'Pausing delays billing-cycle advancement and reconciliation of reserved AI charges.' },
  { id: 'runtime-issues-digest', name: 'Runtime Issues digest', category: 'Maintenance', schedule: '15 21 * * *', workflow: 'runtime-issues-digest.yml', path: '/api/admin/runtime-issues/digest-cron', method: 'POST' },
  { id: 'prospect-conversations', name: 'Prospect conversation maintenance', category: 'Marketing', schedule: '7 * * * *', workflow: 'prospect-conversations.yml', path: '/api/cron/prospect-conversations', method: 'POST' },
  { id: 'customer-service-sync', name: 'Customer service sync and auto-reply', category: 'Customer Service', schedule: '*/15 * * * *', workflow: 'cs-auto-reply.yml', path: '/api/customer-service/sync-cron', method: 'POST' },
  { id: 'marketing-daily', name: 'Daily marketing monitoring and digest', category: 'Marketing', schedule: '35 20 * * *', workflow: 'foresight-daily-digest.yml', path: '/api/foresight/digests/cron', method: 'POST', digestType: 'daily_operations' },
  { id: 'marketing-weekly', name: 'Weekly marketing digest', category: 'Marketing', schedule: '5 21 * * 1', workflow: 'foresight-daily-digest.yml', path: '/api/foresight/digests/cron', method: 'POST', digestType: 'weekly_summary' },
  { id: 'shopify-inventory', name: 'Shopify inventory sync', category: 'Inventory', schedule: '*/15 * * * *', workflow: 'inventory-sync.yml', path: '/api/ims/shopify/sync-inventory', method: 'POST', warning: 'Pausing can leave online stock availability out of date.' },
  { id: 'amazon-inventory', name: 'Amazon inventory sync', category: 'Inventory', schedule: '*/15 * * * *', workflow: 'inventory-sync.yml', path: '/api/ims/channels/amazon/inventory/cron', method: 'POST', warning: 'Pausing can leave online stock availability out of date.' },
  { id: 'product-publication', name: 'Channel product publication', category: 'Inventory', schedule: '*/15 * * * *', workflow: 'inventory-sync.yml', path: '/api/ims/channels/product-publication/cron', method: 'POST' },
  { id: 'product-assignment', name: 'Channel product assignment', category: 'Inventory', schedule: '11 * * * *', workflow: 'channel-product-assignment.yml', path: '/api/ims/channels/product-assignment/cron', method: 'POST' },
  { id: 'amazon-orders', name: 'Amazon order sync', category: 'Orders', schedule: '*/5 * * * *', workflow: 'amazon-orders-sync.yml', path: '/api/ims/channels/amazon/orders/cron', method: 'POST', warning: 'Pausing delays new online orders and their stock commitments.' },
  { id: 'amazon-fulfilments', name: 'Amazon fulfilment sync', category: 'Orders', schedule: '*/5 * * * *', workflow: 'amazon-fulfilments-sync.yml', path: '/api/ims/channels/amazon/fulfilments/cron', method: 'POST', warning: 'Pausing delays shipment confirmations to Amazon.' },
  { id: 'amazon-delivery-tracking', name: 'Online channel delivery tracking', category: 'Orders', schedule: '43 * * * *', workflow: 'amazon-delivery-tracking.yml', path: '/api/ims/channels/amazon/delivery/cron', method: 'POST', defaultEnabled: false, warning: 'Off by default until storage and carrier tracking access are verified. Each business selects channel types in Settings > Shipping; Amazon alone defaults On. Pausing delays delivery information; it does not extend Amazon review deadlines or delete PII.' },
  { id: 'amazon-returns', name: 'Amazon returns sync', category: 'Orders', schedule: '17 * * * *', workflow: 'amazon-returns-sync.yml', path: '/api/ims/channels/amazon/returns/cron', method: 'POST' },
  { id: 'online-sales', name: 'Online sales accounting sync', category: 'Accounting', schedule: '0 14,15 * * *', workflow: 'online-sales-sync.yml', path: '/api/ims/online-sales/auto-sync-cron', method: 'POST', warning: 'Pausing delays online sales accounting.' },
  { id: 'online-recovery', name: 'Online order recovery and accounting retries', category: 'Orders', schedule: '*/5 * * * *', workflow: 'online-recovery.yml', path: '/api/ims/online-sales/recovery-cron', method: 'POST', warning: 'Pausing delays enabled storefront recovery and accounting retries; it does not restore historical startup scans.' },
  { id: 'cogs-sync', name: 'Cost of goods sold sync', category: 'Accounting', schedule: '17 17 * * *', workflow: 'cogs-sync.yml', path: '/api/xero/cogs/cron', method: 'POST', warning: 'Pausing delays cost-of-goods-sold journals.' },
  { id: 'xero-reconciliation', name: 'Xero reconciliation', category: 'Accounting', schedule: '47 */6 * * *', workflow: 'xero-reconciliation.yml', path: '/api/xero/reconciliation/cron', method: 'POST', warning: 'Pausing delays accounting reconciliation.' },
  { id: 'xero-reconciliation-digest', name: 'Xero reconciliation digest', category: 'Accounting', schedule: '23 * * * *', workflow: 'xero-reconciliation-digest.yml', path: '/api/xero/reconciliation/digest-cron', method: 'POST' },
  { id: 'shopify-payouts', name: 'Shopify payout catch-up', category: 'Accounting', schedule: '23 */6 * * *', workflow: 'shopify-payout-catchup.yml', path: '/api/xero/shopify-payouts/catchup-cron', method: 'POST', warning: 'Pausing delays payout reconciliation.' },
  { id: 'shopify-gift-cards', name: 'Shopify gift-card reconciliation', category: 'Accounting', schedule: '17 16 * * *', workflow: 'shopify-gift-card-reconciliation.yml', path: '/api/ims/shopify/gift-cards/reconcile-cron', method: 'POST', warning: 'Pausing delays reconciliation of gift-card balances.' },
  { id: 'shopify-fulfilments', name: 'Shopify order fulfilment reconciliation', category: 'Orders', schedule: '47 16 * * *', workflow: 'shopify-order-fulfilment-reconciliation.yml', path: '/api/ims/shopify/orders/reconcile-fulfilments-cron', method: 'POST' },
  { id: 'klaviyo-outbox', name: 'Klaviyo outbox delivery', category: 'Marketing', schedule: null, workflow: null, path: '/api/klaviyo/outbox/cron', method: 'POST' },
] as const;

export type CronJobId = typeof CRON_JOBS[number]['id'];

export function findCronJob(id: unknown) {
  return CRON_JOBS.find(job => job.id === id);
}

export function cronJobDefaultEnabled(id: CronJobId): boolean {
  const job = findCronJob(id);
  return !(job && 'defaultEnabled' in job && job.defaultEnabled === false);
}