import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool } from '@/services/IMSMySQLService';
import {
  AMAZON_PII_INVENTORY_PAGE_SIZE, AMAZON_PII_RETENTION_DAYS, AMAZON_PII_SOURCES,
  validateAmazonPiiInventoryReport, type AmazonPiiInventoryReport, type AmazonPiiSourceId,
} from './amazonPiiInventory';
import { DELIVERY_EVIDENCE_COLUMNS, EARLIEST_DELIVERY_SQL } from './amazonDeliveryEvidenceRepository';
import { deliveryReviewDeadline } from './amazonDeliveryEvidence';

interface SourceQuery {
  id: AmazonPiiSourceId;
  table: string;
  required: string[];
  link: string;
  populated: string;
  distinct?: boolean;
}

function populated(alias: string, columns: readonly string[]): string {
  return columns.map(column => `NULLIF(TRIM(${alias}.${column}), '') IS NOT NULL`).join(' OR ');
}

const addressColumns = ['delivery_address', 'delivery_address2', 'delivery_suburb', 'delivery_city', 'delivery_state', 'delivery_postcode', 'delivery_country'];
const contactColumns = ['first_name', 'last_name', 'email', 'phone', 'mobile', 'address', 'address2', 'suburb', 'city', 'state', 'postcode'];
const queries: SourceQuery[] = [
  { id: 'order-address', table: 'ims_sales_orders', required: addressColumns, link: 't.id = o.id AND t.business_id = o.business_id',
    populated: populated('t', addressColumns) },
  { id: 'linked-contact', table: 'ims_contacts', required: ['id', 'business_id', 'name', ...contactColumns],
    link: 't.id = o.customer_id AND t.business_id = o.business_id', distinct: true,
    populated: `(NULLIF(TRIM(t.name), '') IS NOT NULL AND TRIM(t.name) NOT IN ('Online Customer', 'Amazon Customer')) OR ${populated('t', contactColumns)}` },
  { id: 'shipment-recipient', table: 'ims_shipping_shipments', required: ['id', 'business_id', 'so_id', 'recipient_json'],
    link: 't.so_id = o.id AND t.business_id = o.business_id', populated: 'JSON_LENGTH(t.recipient_json) > 0' },
  { id: 'shipment-amendment', table: 'ims_shipping_amendments', required: ['business_id', 'shipment_id', 'previous_json', 'desired_json', 'result_json'],
    link: 't.business_id = o.business_id AND t.shipment_id IN (SELECT s.id FROM ims_shipping_shipments s WHERE s.so_id = o.id AND s.business_id = o.business_id)',
    populated: 'JSON_LENGTH(t.previous_json) > 0 OR JSON_LENGTH(t.desired_json) > 0 OR JSON_LENGTH(t.result_json) > 0' },
  { id: 'shipping-label', table: 'ims_shipping_labels', required: ['business_id', 'shipment_id', 'label_url'],
    link: 't.business_id = o.business_id AND t.shipment_id IN (SELECT s.id FROM ims_shipping_shipments s WHERE s.so_id = o.id AND s.business_id = o.business_id)',
    populated: populated('t', ['label_url']) },
  { id: 'order-text', table: 'ims_sales_orders', required: ['notes', 'customer_po_number'], link: 't.id = o.id AND t.business_id = o.business_id',
    populated: `(NULLIF(TRIM(t.notes), '') IS NOT NULL AND (t.external_order_id IS NULL OR TRIM(t.notes) <> CONCAT('Amazon order ', t.external_order_id))) OR ${populated('t', ['customer_po_number'])}` },
  { id: 'order-item-text', table: 'ims_sales_order_items', required: ['business_id', 'so_id', 'notes'],
    link: 't.so_id = o.id AND t.business_id = o.business_id', populated: populated('t', ['notes']) },
  { id: 'credit-note-text', table: 'ims_credit_notes', required: ['id', 'business_id', 'so_id', 'notes', 'reference', 'reversal_reason'],
    link: 't.so_id = o.id AND t.business_id = o.business_id', populated: populated('t', ['notes', 'reference', 'reversal_reason']) },
  { id: 'credit-note-item-text', table: 'ims_credit_note_items', required: ['cn_id', 'name'],
    link: 'EXISTS (SELECT 1 FROM ims_credit_notes c WHERE c.id = t.cn_id AND c.business_id = o.business_id AND c.so_id = o.id)',
    populated: populated('t', ['name']) },
  { id: 'channel-event', table: 'ims_sales_channel_events', required: ['business_id', 'provider', 'channel_instance_id', 'payload_json', 'safe_error'],
    link: `t.business_id = o.business_id AND t.provider = 'amazon' AND t.channel_instance_id = o.channel_instance_id
      AND (JSON_UNQUOTE(JSON_EXTRACT(t.payload_json, '$.amazonOrderId')) = o.external_order_id
        OR JSON_UNQUOTE(JSON_EXTRACT(t.payload_json, '$.salesOrderId')) = CAST(o.id AS CHAR))`,
    populated: `JSON_LENGTH(t.payload_json) > 0 OR ${populated('t', ['safe_error'])}` },
  { id: 'channel-job', table: 'ims_sales_channel_jobs', required: ['business_id', 'provider', 'channel_instance_id', 'payload_json', 'safe_error'],
    link: `t.business_id = o.business_id AND t.provider = 'amazon' AND t.channel_instance_id = o.channel_instance_id
      AND (JSON_UNQUOTE(JSON_EXTRACT(t.payload_json, '$.amazonOrderId')) = o.external_order_id
        OR JSON_UNQUOTE(JSON_EXTRACT(t.payload_json, '$.salesOrderId')) = CAST(o.id AS CHAR))`,
    populated: `JSON_LENGTH(t.payload_json) > 0 OR ${populated('t', ['safe_error'])}` },
  { id: 'shipping-job', table: 'ims_shipping_channel_jobs', required: ['business_id', 'shipment_id', 'request_json', 'response_json', 'safe_error'],
    link: 't.business_id = o.business_id AND t.shipment_id IN (SELECT s.id FROM ims_shipping_shipments s WHERE s.so_id = o.id AND s.business_id = o.business_id)',
    populated: `JSON_LENGTH(t.request_json) > 0 OR JSON_LENGTH(t.response_json) > 0 OR ${populated('t', ['safe_error'])}` },
];
const baseColumns = ['id', 'business_id', 'sales_channel', 'customer_id', 'channel_instance_id', 'external_order_id', 'order_date'];
const shipmentLinkColumns = ['id', 'business_id', 'so_id'];
const select = 'SELECT /*+ MAX_EXECUTION_TIME(10000) */';

async function readRows<T extends RowDataPacket>(connection: PoolConnection, sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await connection.query<T[]>(sql, params);
  return rows;
}

interface CountRow extends RowDataPacket { records: number | string }
interface ColumnRow extends RowDataPacket { TABLE_NAME: string; COLUMN_NAME: string }
interface SummaryRow extends RowDataPacket {
  amazonOrders: number | string; ordersWithPotentialPii: number | string; ordersWithStructuredFields: number | string;
  ordersWithUnreviewedContent: number | string; agedOrdersNeedingReview: number | string;
  ordersWithVerifiedDelivery: number | string | null; ordersPastReviewDeadline: number | string | null;
}
interface OrderRow extends RowDataPacket {
  salesOrderId: number; amazonOrderReference: string | null; orderDate: string | null; ageDays: number | null;
  earliestVerifiedDeliveryAt: string | null;
}

export async function getAmazonPiiInventory(input: { businessId: string; afterId?: number; now?: Date }): Promise<AmazonPiiInventoryReport> {
  const afterId = input.afterId ?? 0;
  const now = input.now ?? new Date();
  if (!input.businessId || !Number.isSafeInteger(afterId) || afterId < 0 || afterId > 2_147_483_647
    || !Number.isFinite(now.getTime())) throw new Error('Invalid Amazon PII inventory scope.');
  return runImsForBusiness(input.businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const tables = [...new Set([...queries.map(source => source.table), 'ims_amazon_delivery_evidence'])];
      const columns = await readRows<ColumnRow>(connection,
        `${select} TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => '?').join(', ')})`, tables);
      const has = (table: string, required: string[]) => required.every(column =>
        columns.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === column));
      if (!has('ims_sales_orders', baseColumns)) throw new Error('Amazon order storage is not ready for the PII inventory. Check the active business schema.');
      const deliveryAvailable = has('ims_amazon_delivery_evidence', DELIVERY_EVIDENCE_COLUMNS);
      const available = queries.filter(source => has(source.table, source.required)
        && (!['shipment-amendment', 'shipping-label', 'shipping-job'].includes(source.id)
          || has('ims_shipping_shipments', shipmentLinkColumns))
        && (source.id !== 'credit-note-item-text' || has('ims_credit_notes', ['id', 'business_id', 'so_id'])));
      const flags = new Map(available.map(source => [source.id,
        `EXISTS (SELECT 1 FROM ${source.table} t WHERE ${source.link} AND (${source.populated}))`]));
      const any = (kind?: 'structured' | 'content-review') => available
        .filter(source => !kind || AMAZON_PII_SOURCES.find(item => item.id === source.id)?.kind === kind)
        .map(source => flags.get(source.id)).join(' OR ') || 'FALSE';
      const scope = "o.business_id = ? AND o.sales_channel = 'amazon'";
      const summaryRows = await readRows<SummaryRow>(connection,
        `${select} COUNT(*) AS amazonOrders,
          COALESCE(SUM(${any()}), 0) AS ordersWithPotentialPii,
          COALESCE(SUM(${any('structured')}), 0) AS ordersWithStructuredFields,
          COALESCE(SUM(${any('content-review')}), 0) AS ordersWithUnreviewedContent,
          COALESCE(SUM((${any()}) AND DATEDIFF(?, o.order_date) >= ?), 0) AS agedOrdersNeedingReview,
          ${deliveryAvailable ? `COALESCE(SUM(${EARLIEST_DELIVERY_SQL} IS NOT NULL), 0)` : 'NULL'} AS ordersWithVerifiedDelivery,
          ${deliveryAvailable ? `COALESCE(SUM((${any()}) AND ${EARLIEST_DELIVERY_SQL} <= DATE_SUB(?, INTERVAL 30 DAY)), 0)` : 'NULL'} AS ordersPastReviewDeadline
          FROM ims_sales_orders o WHERE ${scope}`, [now.toISOString().slice(0, 10), AMAZON_PII_RETENTION_DAYS,
          ...(deliveryAvailable ? [now.toISOString().replace('T', ' ').replace('Z', '')] : []), input.businessId]);
      if (!summaryRows[0]) throw new Error('Amazon PII inventory summary is unavailable.');
      const summary = summaryRows[0];
      const sources = [];
      for (const source of queries) {
        if (!flags.has(source.id)) {
          sources.push({ id: source.id, availability: 'unavailable' as const, records: null });
          continue;
        }
        const standalone = source.id === 'channel-event' || source.id === 'channel-job';
        const rows = await readRows<CountRow>(connection, standalone
          ? `${select} COUNT(*) AS records FROM ${source.table} t WHERE t.business_id = ? AND t.provider = 'amazon' AND (${source.populated})`
          : `${select} COUNT(${source.distinct ? 'DISTINCT t.id' : '*'}) AS records
             FROM ${source.table} t JOIN ims_sales_orders o ON ${source.link}
             WHERE ${scope} AND (${source.populated})`, [input.businessId]);
        if (!rows[0]) throw new Error('Amazon PII source count is unavailable.');
        sources.push({ id: source.id, availability: 'available' as const, records: Number(rows[0].records) });
      }
      const rows = await readRows<OrderRow>(connection,
        `${select} o.id AS salesOrderId,
          CASE WHEN CHAR_LENGTH(o.external_order_id) = 19 AND o.external_order_id REGEXP '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' THEN o.external_order_id ELSE NULL END AS amazonOrderReference,
          DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate,
          GREATEST(0, DATEDIFF(?, o.order_date)) AS ageDays,
          ${deliveryAvailable ? `DATE_FORMAT(${EARLIEST_DELIVERY_SQL}, '%Y-%m-%dT%H:%i:%s.%fZ')` : 'NULL'} AS earliestVerifiedDeliveryAt
          ${available.map(source => `, ${flags.get(source.id)} AS \`${source.id}\``).join('')}
          FROM ims_sales_orders o WHERE ${scope} AND o.id > ? AND (${any()})
          ORDER BY o.id LIMIT ?`, [now.toISOString().slice(0, 10), input.businessId, afterId, AMAZON_PII_INVENTORY_PAGE_SIZE + 1]);
      const orders = rows.slice(0, AMAZON_PII_INVENTORY_PAGE_SIZE).map(row => {
        const earliest = row.earliestVerifiedDeliveryAt === null ? null : new Date(row.earliestVerifiedDeliveryAt).toISOString();
        return {
        salesOrderId: Number(row.salesOrderId), amazonOrderReference: row.amazonOrderReference, orderDate: row.orderDate,
        ageDays: row.ageDays === null ? null : Number(row.ageDays),
        sourceIds: available.filter(source => Number(row[source.id]) === 1).map(source => source.id),
        earliestVerifiedDeliveryAt: earliest, reviewDeadlineAt: earliest ? deliveryReviewDeadline(earliest) : null,
      }; });
      const report = validateAmazonPiiInventoryReport({
        mode: 'read-only', generatedAt: now.toISOString(),
        summary: {
          amazonOrders: Number(summary.amazonOrders), ordersWithPotentialPii: Number(summary.ordersWithPotentialPii),
          ordersWithStructuredFields: Number(summary.ordersWithStructuredFields),
          ordersWithUnreviewedContent: Number(summary.ordersWithUnreviewedContent),
          agedOrdersNeedingReview: Number(summary.agedOrdersNeedingReview), confirmedOverdue: null,
        },
        sources, orders, afterId, deliveryEvidence: {
          availability: deliveryAvailable ? 'available' : 'unavailable',
          ordersWithVerifiedDelivery: deliveryAvailable ? Number(summary.ordersWithVerifiedDelivery) : null,
          ordersPastReviewDeadline: deliveryAvailable ? Number(summary.ordersPastReviewDeadline) : null,
        },
        nextAfterId: rows.length > AMAZON_PII_INVENTORY_PAGE_SIZE ? orders[orders.length - 1].salesOrderId : null,
      });
      await connection.commit();
      return report;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}
