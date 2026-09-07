import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';

export type IntegrationIssueCategory =
  | 'authentication'
  | 'account_mapping'
  | 'tax_mapping'
  | 'tracking_mapping'
  | 'payment_mapping'
  | 'rate_limit'
  | 'validation'
  | 'service_unavailable'
  | 'unknown';

export function classifyIntegrationIssue(value: unknown): IntegrationIssueCategory {
  const text = String(value ?? '').toLocaleLowerCase('en-AU');
  if (/account code|account mapping|account.*missing|missing.*account/.test(text)) return 'account_mapping';
  if (/tax code|tax rate|tax mapping/.test(text)) return 'tax_mapping';
  if (/tracking category|tracking option|tracking mapping/.test(text)) return 'tracking_mapping';
  if (/payment method|payment account|gateway mapping|clearing account/.test(text)) return 'payment_mapping';
  if (/unauthori[sz]ed|forbidden|oauth|token|credential|reconnect|authentication/.test(text)) return 'authentication';
  if (/rate limit|too many requests|throttl/.test(text)) return 'rate_limit';
  if (/invalid|validation|required|cannot|can't|must be/.test(text)) return 'validation';
  if (/timeout|timed out|unavailable|bad gateway|service error|5\d\d/.test(text)) return 'service_unavailable';
  return 'unknown';
}

export function sanitizeIntegrationSummary(value: unknown): string {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[external URL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(token|secret|password|authorization|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export interface XeroDiagnosticsInput {
  businessId: string;
  days: number;
  limit?: number;
}

export async function loadXeroDiagnostics(input: XeroDiagnosticsInput) {
  const limit = Math.min(30, Math.max(1, input.limit ?? 30));
  const connection = await ConnectionsRepository.get(input.businessId);
  const queued = await imsQuery<any>(
    `SELECT id, reference, source_type, source_status, amount
       FROM (
         SELECT po.id, po.po_number AS reference, 'purchase_order' AS source_type,
                po.status AS source_status, po.total_amount AS amount
           FROM ims_purchase_orders po
          WHERE po.business_id = ? AND po.xero_sync_status = 'queued'
         UNION ALL
         SELECT so.id, so.so_number AS reference, 'sales_order' AS source_type,
                so.status AS source_status, so.total_amount AS amount
           FROM ims_sales_orders so
          WHERE so.business_id = ? AND so.xero_sync_status = 'queued' AND so.is_staff_preview_test = 0
         UNION ALL
         SELECT cn.id, cn.cn_number AS reference, 'customer_credit_note' AS source_type,
                cn.status AS source_status, cn.total_amount AS amount
           FROM ims_credit_notes cn
          WHERE cn.business_id = ? AND cn.xero_sync_status = 'queued'
         UNION ALL
         SELECT scn.id, scn.scn_number AS reference, 'supplier_credit_note' AS source_type,
                scn.status AS source_status, scn.total_amount AS amount
           FROM ims_supplier_credit_notes scn
          WHERE scn.business_id = ? AND scn.xero_sync_status = 'queued'
       ) queued_sources
      ORDER BY source_type, reference
      LIMIT ${limit + 1}`,
    [input.businessId, input.businessId, input.businessId, input.businessId],
  );
  const failures = await query<any>(
    `SELECT id, sync_type, reference_id, status, xero_state, detail, created_at
       FROM xero_sync_log
      WHERE business_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND status IN ('error', 'skipped')
      ORDER BY created_at DESC
      LIMIT ?`,
    [input.businessId, input.days, limit + 1],
  );

  return {
    connected: Boolean(connection?.xero_tenant_id && (connection.xero_refresh_token || connection.xero_access_token)),
    queued: queued.slice(0, limit).map(row => ({
      sourceId: Number(row.id),
      reference: row.reference,
      sourceType: row.source_type,
      sourceStatus: row.source_status,
      amount: Number(row.amount ?? 0),
    })),
    recentFailures: failures.slice(0, limit).map(row => ({
      eventId: Number(row.id),
      syncType: row.sync_type,
      referenceId: row.reference_id == null ? null : Number(row.reference_id),
      status: row.status,
      xeroState: row.xero_state ?? null,
      category: classifyIntegrationIssue(row.detail),
      occurredAt: row.created_at,
    })),
    queuedTruncated: queued.length > limit,
    failuresTruncated: failures.length > limit,
  };
}

export interface ShopifyDiagnosticsInput {
  businessId: string;
  limit?: number;
}

export async function loadShopifyDiagnostics(input: ShopifyDiagnosticsInput) {
  const limit = Math.min(30, Math.max(1, input.limit ?? 30));
  const [connection, counts, settings, logRows] = await Promise.all([
    ConnectionsRepository.get(input.businessId),
    ImsShopifyRepo.getCounts(input.businessId),
    imsQuery<{ key: string; value: string | null }>(
      "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN ('shopify_order_sync_enabled', 'shopify_webhook_secret')",
      [input.businessId],
    ),
    ImsShopifyRepo.getLog(limit + 1, input.businessId),
  ]);
  const setting = (key: string) => settings.find(row => row.key === key)?.value ?? '';
  const connected = connection?.shopify_auth_mode === 'client_credentials'
    ? Boolean(connection.shopify_shop_id && connection.shopify_client_id && connection.shopify_client_secret)
    : Boolean(connection?.shopify_shop_id && connection.shopify_access_token);

  return {
    connected,
    orderSyncEnabled: setting('shopify_order_sync_enabled') === '1',
    webhookSecretConfigured: Boolean(setting('shopify_webhook_secret')),
    catalogue: counts,
    recentActivity: logRows.slice(0, limit).map(row => ({
      eventId: Number(row.id),
      action: row.action,
      status: row.status,
      category: row.status === 'success' ? null : classifyIntegrationIssue(row.summary),
      summary: sanitizeIntegrationSummary(row.summary),
      occurredAt: row.created_at,
    })),
    truncated: logRows.length > limit,
    webhookRegistrationChecked: false,
  };
}
