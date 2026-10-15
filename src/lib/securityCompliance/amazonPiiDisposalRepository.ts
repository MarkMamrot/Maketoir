import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool } from '@/services/IMSMySQLService';
import { ACTIVE_DELIVERY_EVIDENCE_SQL, EARLIEST_DELIVERY_SQL } from './amazonDeliveryEvidenceRepository';
import { deliveryReviewDeadline } from './amazonDeliveryEvidence';
import {
  AMAZON_CUSTOMER_LABEL, AMAZON_PII_CONTACT_FIELDS, AMAZON_PII_ORDER_FIELDS,
  AmazonPiiConflictError, AmazonPiiNotFoundError, AmazonPiiValidationError,
  hasIdentifyingContactFields, scrubAmazonBuyerFields,
  type AmazonPiiDisposalPreview, type AmazonPiiDisposalRequest,
} from './amazonPiiDisposal';
import guards from '../../../scripts/amazon-pii-guards.json';

type StoredRow = RowDataPacket & { id: number; business_id: string };
type Change = { table: string; id: number; fields: Record<string, string | null>; source: string; count: number };
type Snapshot = {
  order: StoredRow; contact: StoredRow | null; groups: Record<string, StoredRow[]>;
  sharedContact: boolean; sharedLabels: boolean; outstandingParcels: boolean; receipt: StoredRow | null;
};
const tableColumns: Record<string, string[]> = {
  ims_amazon_pii_disposals: ['business_id', 'so_id', 'channel_instance_id', 'external_order_id', 'protected_contact_id',
    'earliest_delivered_at', 'deadline_at', 'actor_user_id', 'operation_key', 'request_hash', 'counts_json', 'cleared_at'],
  ims_sales_orders: ['id', 'business_id', 'sales_channel', 'channel_instance_id', 'external_order_id', 'customer_id', 'status', ...AMAZON_PII_ORDER_FIELDS],
  ims_contacts: ['id', 'business_id', 'name', 'type', 'store_credit', 'country', 'company', ...AMAZON_PII_CONTACT_FIELDS],
  ims_shipping_shipments: ['id', 'business_id', 'so_id', 'status', 'recipient_json'],
  ims_shipping_amendments: ['id', 'business_id', 'shipment_id', 'status', 'previous_json', 'desired_json', 'result_json'],
  ims_shipping_labels: ['id', 'business_id', 'shipment_id', 'status', 'label_url', 'provider_request_id'],
  ims_shipping_parcels: ['id', 'business_id', 'shipment_id'],
  ims_amazon_delivery_evidence: ['id', 'business_id', 'so_id', 'parcel_id', 'kind', 'delivered_at', 'voids_evidence_id'],
  ims_sales_channel_events: ['id', 'business_id', 'channel_instance_id', 'provider', 'status', 'payload_json'],
  ims_sales_channel_jobs: ['id', 'business_id', 'channel_instance_id', 'provider', 'status', 'payload_json'],
  ims_shipping_channel_jobs: ['id', 'business_id', 'shipment_id', 'status', 'request_json', 'response_json'],
  ims_credit_notes: ['id', 'business_id', 'so_id', 'customer_id'],
};

async function rows<T extends RowDataPacket>(connection: PoolConnection, sql: string, params: Array<string | number | null> = []): Promise<T[]> {
  const [result] = await connection.execute<T[]>(sql.replace(/^SELECT /, 'SELECT /*+ MAX_EXECUTION_TIME(10000) */ '), params);
  return result;
}
function identifier(value: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error('Invalid cleanup storage metadata.');
  return `\`${value}\``;
}
function mac(value: unknown): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new Error('The configured encryption key is required to protect cleanup previews.');
  return createHmac('sha256', Buffer.from(key, 'hex')).update('amazon-pii-disposal-v1:').update(JSON.stringify(value)).digest('hex');
}
function filled(value: unknown): boolean { return value != null && String(value).trim() !== ''; }

async function assertStorage(connection: PoolConnection): Promise<void> {
  const columns = await rows<RowDataPacket>(connection,
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Object.keys(tableColumns).map(() => '?').join(',')})`,
    Object.keys(tableColumns));
  const missing = Object.entries(tableColumns).some(([table, required]) =>
    required.some(column => !columns.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === column)));
  const installed = await rows<RowDataPacket>(connection,
    'SELECT TRIGGER_NAME, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()');
  const normalizeSql = (sql: unknown) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
  const indexes = await rows<RowDataPacket>(connection,
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_amazon_pii_disposals'");
  if (missing || guards.some(guard => !installed.some(row =>
    row.TRIGGER_NAME === guard.name && normalizeSql(row.ACTION_STATEMENT) === normalizeSql(guard.body)))
    || ['uq_amazon_pii_order', 'uq_amazon_pii_external', 'uq_amazon_pii_operation', 'idx_amazon_pii_contact']
      .some(index => !indexes.some(row => row.INDEX_NAME === index))) {
    throw new Error('Amazon identifying-field cleanup storage or write guards are not ready. Apply and verify the approved tenant rollout first.');
  }
}

async function snapshot(connection: PoolConnection, businessId: string, orderId: number, lock: boolean): Promise<Snapshot> {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [order] = await rows<StoredRow>(connection,
    `SELECT o.*, DATE_FORMAT(${EARLIEST_DELIVERY_SQL}, '%Y-%m-%dT%H:%i:%s.%fZ') AS earliest
       FROM ims_sales_orders o WHERE o.business_id = ? AND o.id = ? AND o.sales_channel = 'amazon'${suffix}`,
    [businessId, orderId]);
  if (!order) throw new AmazonPiiNotFoundError('Amazon order not found in the active business.');
  const [receipt] = await rows<StoredRow>(connection,
    `SELECT * FROM ims_amazon_pii_disposals WHERE business_id = ? AND so_id = ?${suffix}`, [businessId, orderId]);
  const [contact] = order.customer_id == null ? [] : await rows<StoredRow>(connection,
    `SELECT * FROM ims_contacts WHERE business_id = ? AND id = ?${suffix}`, [businessId, order.customer_id]);
  if (order.customer_id != null && !contact) throw new Error('The order customer association could not be verified.');
  if (JSON.stringify([order, contact]).length > 2_000_000) throw new Error('The order or customer exceeds the cleanup review limit.');
  const groups: Record<string, StoredRow[]> = {};
  async function group(table: string, condition: string, params: Array<string | number | null>) {
    const data = await rows<StoredRow>(connection, `SELECT * FROM ${identifier(table)} WHERE business_id = ? AND ${condition}
      ORDER BY id LIMIT 501${suffix}`, [businessId, ...params]);
    if (data.length > 500 || JSON.stringify(data).length > 2_000_000) throw new Error('This order exceeds the cleanup review limit.');
    if (data.some(row => !Number.isSafeInteger(Number(row.id)) || Number(row.id) < 1)) throw new Error('A stored copy has an invalid identifier; cleanup was blocked.');
    groups[table] = data;
  }
  await group('ims_shipping_shipments', 'so_id = ?', [orderId]);
  const shipmentIds = groups.ims_shipping_shipments.map(row => Number(row.id));
  for (const table of ['ims_shipping_amendments', 'ims_shipping_labels', 'ims_shipping_channel_jobs']) {
    if (shipmentIds.length) await group(table, `shipment_id IN (${shipmentIds.map(() => '?').join(',')})`, shipmentIds);
    else groups[table] = [];
  }
  for (const table of ['ims_sales_channel_events', 'ims_sales_channel_jobs']) {
    await group(table, `provider = 'amazon' AND channel_instance_id = ?
      AND (JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.amazonOrderId')) = ?
        OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.salesOrderId')) = ?)`,
    [order.channel_instance_id, order.external_order_id, String(orderId)]);
  }
  let sharedContact = false;
  if (contact && hasIdentifyingContactFields(contact)) {
    const references = await rows<RowDataPacket>(connection,
      `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('customer_id','contact_id','supplier_id')
        AND TABLE_NAME <> 'ims_amazon_pii_disposals' ORDER BY TABLE_NAME, COLUMN_NAME`);
    for (const reference of references) {
      const table = String(reference.TABLE_NAME);
      const column = String(reference.COLUMN_NAME);
      const exceptions = table === 'ims_sales_orders' ? ' AND NOT (id <=> ? AND business_id <=> ?)'
        : table === 'ims_credit_notes' ? ' AND NOT (so_id <=> ? AND business_id <=> ?)' : '';
      const params = exceptions ? [contact.id, orderId, businessId] : [contact.id];
      const linked = await rows<RowDataPacket>(connection,
        `SELECT ${identifier(column)} FROM ${identifier(table)} WHERE ${identifier(column)} = ?${exceptions} LIMIT 1${suffix}`, params);
      if (linked.length) sharedContact = true;
    }
    if (!['retail_customer', 'b2b_customer'].includes(String(contact.type))
      || Number(contact.store_credit) !== 0 || filled(contact.shopify_customer_id)
      || filled(contact.cin7_contact_id) || filled(contact.cin7_customer_id) || filled(contact.password_hash)) sharedContact = true;
  }
  const sharedLabelRows = await rows<RowDataPacket>(connection,
    `SELECT l.id FROM ims_shipping_labels l JOIN ims_shipping_shipments s
       ON s.id = l.shipment_id AND s.business_id = l.business_id
      WHERE l.business_id = ? AND s.so_id = ? AND l.label_url IS NOT NULL AND EXISTS (
        SELECT 1 FROM ims_shipping_labels other JOIN ims_shipping_shipments other_s
          ON other_s.id = other.shipment_id AND other_s.business_id = other.business_id
        WHERE other.business_id = l.business_id AND other_s.so_id <> s.so_id
          AND (other.label_url = l.label_url OR (l.provider_request_id IS NOT NULL
            AND other.provider_request_id = l.provider_request_id))) LIMIT 1`,
    [businessId, orderId]);
  const outstanding = await rows<RowDataPacket>(connection,
    `SELECT p.id FROM ims_shipping_parcels p JOIN ims_shipping_shipments s
       ON s.id = p.shipment_id AND s.business_id = p.business_id
      WHERE s.business_id = ? AND s.so_id = ? AND s.voided_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM ims_amazon_delivery_evidence d WHERE d.business_id = s.business_id AND d.so_id = s.so_id
          AND (d.parcel_id = p.id OR d.parcel_id IS NULL) AND ${ACTIVE_DELIVERY_EVIDENCE_SQL}) LIMIT 1`,
    [businessId, orderId]);
  return { order, contact: contact ?? null, groups, sharedContact, sharedLabels: sharedLabelRows.length > 0,
    outstandingParcels: outstanding.length > 0, receipt: receipt ?? null };
}

function changes(data: Snapshot): Change[] {
  const result: Change[] = [];
  const addressFields = Object.fromEntries(AMAZON_PII_ORDER_FIELDS.map(field => [field, null]));
  const addresses = AMAZON_PII_ORDER_FIELDS.filter(field => filled(data.order[field])).length;
  if (addresses) result.push({ table: 'ims_sales_orders', id: data.order.id, fields: addressFields, source: 'Order address', count: addresses });
  if (data.contact && hasIdentifyingContactFields(data.contact) && !data.sharedContact) {
    const fields: Record<string, string | null> = { name: AMAZON_CUSTOMER_LABEL, ...Object.fromEntries([...AMAZON_PII_CONTACT_FIELDS, 'country'].map(field => [field, null])) };
    result.push({ table: 'ims_contacts', id: data.contact.id, fields, source: 'Exclusive customer details',
      count: Object.keys(fields).filter(field => data.contact![field] !== fields[field] && filled(data.contact![field])).length });
  }
  const jsonColumns: Record<string, string[]> = {
    ims_shipping_shipments: ['recipient_json'], ims_shipping_amendments: ['previous_json', 'desired_json', 'result_json'],
    ims_sales_channel_events: ['payload_json'], ims_sales_channel_jobs: ['payload_json'],
    ims_shipping_channel_jobs: ['request_json', 'response_json'],
  };
  for (const [table, columns] of Object.entries(jsonColumns)) {
    for (const row of data.groups[table]) {
      const fields: Record<string, string | null> = {};
      let count = 0;
      for (const column of columns) {
        if (row[column] === null) continue;
        const scrubbed = scrubAmazonBuyerFields(row[column], table === 'ims_shipping_shipments');
        if (scrubbed.fields) { fields[column] = JSON.stringify(scrubbed.value); count += scrubbed.fields; }
      }
      if (count) result.push({ table, id: row.id, fields, source: table === 'ims_shipping_shipments'
        ? 'Shipment recipients' : table === 'ims_shipping_amendments' ? 'Amendment buyer fields' : 'Stored payload buyer fields', count });
    }
  }
  for (const row of data.groups.ims_shipping_labels) {
    if (filled(row.label_url)) result.push({ table: 'ims_shipping_labels', id: row.id,
      fields: { label_url: null, label_url_expires_at: null, status: 'pii_cleared' }, source: 'Disable old label access (PDF copies require review)', count: 1 });
  }
  return result;
}

function preview(data: Snapshot, businessId: string, actorUserId: number, now: Date, expiresAt: string): AmazonPiiDisposalPreview {
  const earliest = data.order.earliest ? new Date(String(data.order.earliest)).toISOString() : null;
  const deadline = earliest ? deliveryReviewDeadline(earliest) : null;
  const blockers: string[] = [];
  if (!earliest) blockers.push('Verified original buyer delivery is missing.');
  if (earliest && Date.parse(earliest) > now.getTime()) blockers.push('Verified original buyer delivery is dated in the future. Resolve the delivery evidence first.');
  if (!['fulfilled', 'cancelled'].includes(String(data.order.status))) blockers.push('Resolve outstanding order fulfilment first.');
  if (data.outstandingParcels) blockers.push('Some original parcels do not have verified delivery evidence.');
  if (data.sharedContact) blockers.push('Identifying customer details are shared, externally mapped or financially active. Resolve manually; customer and ledger ownership will not change.');
  if (data.sharedLabels) blockers.push('An old label PDF is shared with another order. Resolve the shared identifying copy first.');
  if (!/^\d{3}-\d{7}-\d{7}$/.test(String(data.order.external_order_id)) || !filled(data.order.channel_instance_id)) {
    blockers.push('The Amazon order identity could not be verified.');
  }
  if (data.groups.ims_shipping_shipments.some(row => !['complete', 'voided'].includes(String(row.status)))
    || data.groups.ims_shipping_amendments.some(row => !['confirmed', 'rejected'].includes(String(row.status)))
    || data.groups.ims_sales_channel_events.some(row => !['complete', 'ignored'].includes(String(row.status)))
    || data.groups.ims_sales_channel_jobs.some(row => row.status !== 'complete')
    || data.groups.ims_shipping_channel_jobs.some(row => row.status !== 'complete')) blockers.push('Resolve pending, failed or ambiguous operational work first.');
  const planned = data.receipt ? [] : changes(data);
  const fieldsToClear = [...new Set(planned.map(change => change.source))].map(source => ({
    source, fields: planned.filter(change => change.source === source).reduce((sum, change) => sum + change.count, 0),
    records: planned.filter(change => change.source === source).length,
  }));
  return {
    businessId, salesOrderId: Number(data.order.id),
    amazonOrderReference: /^\d{3}-\d{7}-\d{7}$/.test(String(data.order.external_order_id)) ? String(data.order.external_order_id) : '',
    earliestDeliveredAt: earliest, deadlineAt: deadline, generatedAt: now.toISOString(), expiresAt,
    token: mac({ businessId, actorUserId, expiresAt, data }), blockers, fieldsToClear,
    alreadyCleared: Boolean(data.receipt), copyReviewRequired: true,
  };
}

function scope(businessId: string, salesOrderId: number, actorUserId: number): void {
  if (!businessId || !Number.isSafeInteger(salesOrderId) || salesOrderId <= 0
    || !Number.isSafeInteger(actorUserId) || actorUserId <= 0) throw new AmazonPiiValidationError('Invalid cleanup scope.');
}

export async function getAmazonPiiDisposalPreview(input: {
  businessId: string; salesOrderId: number; actorUserId: number; now?: Date;
}): Promise<AmazonPiiDisposalPreview> {
  scope(input.businessId, input.salesOrderId, input.actorUserId);
  const now = input.now ?? new Date();
  return runImsForBusiness(input.businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await assertStorage(connection);
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const data = await snapshot(connection, input.businessId, input.salesOrderId, false);
      const report = preview(data, input.businessId, input.actorUserId, now, new Date(now.getTime() + 15 * 60_000).toISOString());
      await connection.commit();
      return report;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  });
}

export async function approveAmazonPiiDisposal(input: {
  businessId: string; actorUserId: number; request: AmazonPiiDisposalRequest; now?: Date;
}): Promise<{ salesOrderId: number; structuredFieldsCleared: true; copyReviewRequired: true; alreadyCleared: boolean }> {
  const request = input.request;
  scope(input.businessId, request.salesOrderId, input.actorUserId);
  if (request.expectedBusinessId !== input.businessId) throw new AmazonPiiConflictError('The active business changed. Load a fresh preview.');
  const now = input.now ?? new Date();
  const requestHash = mac({ businessId: input.businessId, actorUserId: input.actorUserId, request });
  return runImsForBusiness(input.businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await assertStorage(connection);
      await connection.beginTransaction();
      const data = await snapshot(connection, input.businessId, request.salesOrderId, true);
      if (data.receipt) {
        if (data.receipt.operation_key !== request.operationKey || data.receipt.request_hash !== requestHash) {
          throw new AmazonPiiConflictError('This order already has a different cleanup approval. Reload its preview.');
        }
        await connection.commit();
        return { salesOrderId: request.salesOrderId, structuredFieldsCleared: true, copyReviewRequired: true, alreadyCleared: true };
      }
      const expires = Date.parse(request.expiresAt);
      if (expires <= now.getTime() || expires > now.getTime() + 15 * 60_000) throw new AmazonPiiConflictError('The preview expired. Load a fresh preview.');
      const current = preview(data, input.businessId, input.actorUserId, now, request.expiresAt);
      if (!timingSafeEqual(Buffer.from(current.token, 'hex'), Buffer.from(request.token, 'hex'))) throw new AmazonPiiConflictError('The order or its stored copies changed. Load a fresh preview.');
      if (current.blockers.length) throw new AmazonPiiConflictError(current.blockers.join(' '));
      const planned = changes(data);
      for (const change of planned) {
        await connection.execute(
          `UPDATE ${identifier(change.table)} SET ${Object.keys(change.fields).map(field => `${identifier(field)} = ?`).join(',')}
            WHERE business_id = ? AND id = ?`, [...Object.values(change.fields), input.businessId, change.id]);
      }
      await connection.execute(
        `INSERT INTO ims_amazon_pii_disposals
          (business_id, so_id, channel_instance_id, external_order_id, protected_contact_id, earliest_delivered_at,
           deadline_at, actor_user_id, operation_key, request_hash, counts_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, request.salesOrderId, data.order.channel_instance_id, data.order.external_order_id,
          data.contact?.id ?? null,
          current.earliestDeliveredAt!.replace('T', ' ').replace('Z', ''), current.deadlineAt!.replace('T', ' ').replace('Z', ''),
          input.actorUserId, request.operationKey, requestHash, JSON.stringify(current.fieldsToClear)]);
      await connection.commit();
      return { salesOrderId: request.salesOrderId, structuredFieldsCleared: true, copyReviewRequired: true, alreadyCleared: false };
    } catch (error) {
      await connection.rollback();
      if (error instanceof Error && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        throw new AmazonPiiConflictError('A cleanup approval already exists or its operation key was reused. Reload the preview.');
      }
      throw error;
    }
    finally { connection.release(); }
  });
}
