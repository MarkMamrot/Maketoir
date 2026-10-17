import { randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { CatalogueAcknowledgement, CatalogueDelivery, CatalogueResponse } from './catalogueProtocol';
import { nextCalendarMonth } from './catalogueProtocol';
import { catalogueSettings, projectCatalogue } from './catalogueProjection';

const BATCH_SIZE = 400;
const LEASE_SECONDS = 180;
interface Generation { variant_id: string; generation: string }
interface Pending {
  delivery: CatalogueDelivery;
  generations: Generation[];
  pricingDate: string;
}

export class CatalogueRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export async function withLegacyCatalogueLease<T>(connection: Pick<PoolConnection, 'query'>, businessId: string, work: () => Promise<T>): Promise<T> {
  const [enabled] = await connection.query<RowDataPacket[]>(
    "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'pos_catalogue_sync_v2'", [businessId],
  );
  if (enabled[0]?.value !== 'yes') return work();
  const owner = randomUUID();
  const [lease] = await connection.query<ResultSetHeader>(
    `UPDATE pos_catalogue_control SET lease_owner = ?, lease_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${LEASE_SECONDS} SECOND)
     WHERE business_id = ? AND ready = 1 AND (lease_owner IS NULL OR lease_until <= UTC_TIMESTAMP(3))`, [owner, businessId],
  );
  if (!lease.affectedRows) throw new CatalogueRequestError('Catalogue rebuild is waiting for another register. Retry shortly.', 503);
  let renewal: Promise<void> | undefined;
  let leaseFailure: unknown;
  const heartbeat = setInterval(() => {
    if (!renewal && !leaseFailure) {
      renewal = connection.query<ResultSetHeader>(
        `UPDATE pos_catalogue_control SET lease_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${LEASE_SECONDS} SECOND)
         WHERE business_id = ? AND lease_owner = ? AND lease_until > UTC_TIMESTAMP(3)`, [businessId, owner],
      ).then(([result]) => {
        if (!result.affectedRows) throw new Error('Legacy catalogue rebuild lost its lease.');
      }).catch(error => { leaseFailure = error; }).finally(() => { renewal = undefined; });
    }
  }, 45_000);
  try {
    const result = await work();
    clearInterval(heartbeat);
    await renewal;
    if (leaseFailure) throw leaseFailure;
    return result;
  } finally {
    clearInterval(heartbeat);
    await renewal;
    await connection.query('UPDATE pos_catalogue_control SET lease_owner = NULL, lease_until = NULL WHERE business_id = ? AND lease_owner = ?', [businessId, owner]);
  }
}

export interface CatalogueRequest {
  consumerId: string;
  full: boolean;
  ack?: string;
  renew?: string;
  refreshIds?: string[];
  supportsLocks?: boolean;
}

export function parseCatalogueRequest(value: unknown): CatalogueRequest {
  if (typeof value !== 'object' || value === null || !('consumerId' in value)
    || typeof value.consumerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.consumerId)
    || !('full' in value) || typeof value.full !== 'boolean'
    || ('refreshIds' in value && (!Array.isArray(value.refreshIds) || value.refreshIds.length > BATCH_SIZE || !value.refreshIds.every(id => typeof id === 'string' && id.length <= 36)))
    || ('ack' in value && (typeof value.ack !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.ack)))
    || ('renew' in value && (typeof value.renew !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.renew)))
    || ('supportsLocks' in value && typeof value.supportsLocks !== 'boolean')
    || ('ack' in value && 'renew' in value)) {
    throw new CatalogueRequestError('Invalid catalogue request.', 400);
  }
  return { consumerId: value.consumerId, full: value.full, ack: 'ack' in value ? String(value.ack) : undefined,
    renew: 'renew' in value ? String(value.renew) : undefined,
    supportsLocks: 'supportsLocks' in value && typeof value.supportsLocks === 'boolean' ? value.supportsLocks : undefined,
    refreshIds: 'refreshIds' in value && Array.isArray(value.refreshIds) ? value.refreshIds : [] };
}

export async function catalogueSync(
  connection: PoolConnection, businessId: string, locationId: number, request: CatalogueRequest,
): Promise<CatalogueResponse | CatalogueAcknowledgement | { renewed: true }> {
  await connection.beginTransaction();
  try {
    const [enabled] = await connection.query<RowDataPacket[]>(
      "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'pos_catalogue_sync_v2'", [businessId],
    );
    if (enabled[0]?.value !== 'yes') {
      await connection.commit();
      return { protocol: 2, mode: 'disabled', retryAfterMs: 300_000 };
    }
    if (request.supportsLocks === false) throw new CatalogueRequestError('Update this browser before using incremental catalogue sync.', 426);
    let [controls] = await connection.query<RowDataPacket[]>(
      'SELECT epoch, ready FROM pos_catalogue_control WHERE business_id = ?', [businessId],
    );
    if (!controls.length) {
      await connection.query(`INSERT IGNORE INTO pos_catalogue_control (business_id, epoch, ready)
        SELECT ?, UUID(), 1 FROM pos_catalogue_control WHERE business_id = '' AND ready = 1`, [businessId]);
      [controls] = await connection.query<RowDataPacket[]>('SELECT epoch, ready FROM pos_catalogue_control WHERE business_id = ?', [businessId]);
    }
    const control = controls[0];
    if (!control?.ready) throw new Error('POS catalogue change tracking has not been verified for this business.');
    await connection.query(
      `INSERT IGNORE INTO pos_catalogue_consumers (consumer_id, business_id, location_id, epoch) VALUES (?, ?, ?, ?)`,
      [request.consumerId, businessId, locationId, control.epoch],
    );
    const [consumers] = await connection.query<RowDataPacket[]>(
      'SELECT * FROM pos_catalogue_consumers WHERE consumer_id = ? FOR UPDATE', [request.consumerId],
    );
    const consumer = consumers[0];
    if (consumer.business_id !== businessId || consumer.location_id !== locationId) throw new CatalogueRequestError('Catalogue scope mismatch.', 403);
    if (consumer.epoch !== control.epoch) {
      await connection.query('DELETE FROM pos_catalogue_acknowledgements WHERE consumer_id = ?', [request.consumerId]);
      await connection.query('UPDATE pos_catalogue_consumers SET epoch = ?, initialized = 0, pending_json = NULL WHERE consumer_id = ?', [control.epoch, request.consumerId]);
      consumer.initialized = 0;
      consumer.pending_json = null;
    }
    const pending: Pending | null = consumer.pending_json ? JSON.parse(String(consumer.pending_json)) : null;
    if (request.renew) {
      if (pending?.delivery.mode !== 'full' || pending.delivery.receipt !== request.renew) {
        throw new CatalogueRequestError('Full catalogue lease is no longer owned by this request.', 409);
      }
      const [lease] = await connection.query<RowDataPacket[]>(
        'SELECT lease_owner FROM pos_catalogue_control WHERE business_id = ? AND lease_owner = ? AND lease_until > UTC_TIMESTAMP(3) FOR UPDATE',
        [businessId, request.renew],
      );
      if (!lease.length) throw new CatalogueRequestError('Full catalogue lease expired; rebuild again.', 409);
      await connection.query(`UPDATE pos_catalogue_control SET lease_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${LEASE_SECONDS} SECOND) WHERE business_id = ? AND lease_owner = ?`,
        [businessId, request.renew]);
      await connection.commit();
      return { renewed: true };
    }
    if (request.ack) {
      if (consumer.last_receipt === request.ack) {
        const settings = await catalogueSettings(connection, businessId, locationId);
        await connection.commit();
        const completedFullAt = Number(consumer.last_full_at);
        return { acknowledged: true, completedFullAt, nextFullAt: nextCalendarMonth(completedFullAt, settings.timeZone) };
      }
      if (!pending || pending.delivery.receipt !== request.ack) throw new CatalogueRequestError('Catalogue receipt expired; refresh again.', 409);
      if (pending.delivery.mode === 'full') {
        const [lease] = await connection.query<RowDataPacket[]>(
          'SELECT lease_owner FROM pos_catalogue_control WHERE business_id = ? AND lease_owner = ? AND lease_until > UTC_TIMESTAMP(3) FOR UPDATE',
          [businessId, request.ack],
        );
        if (!lease.length) {
          await connection.query('UPDATE pos_catalogue_consumers SET pending_json = NULL WHERE consumer_id = ?', [request.consumerId]);
          await connection.commit();
          throw new CatalogueRequestError('Full catalogue lease expired; rebuild again.', 409);
        }
      }
      for (let offset = 0; offset < pending.generations.length; offset += BATCH_SIZE) {
        const batch = pending.generations.slice(offset, offset + BATCH_SIZE);
        await connection.query(`INSERT INTO pos_catalogue_acknowledgements (consumer_id, variant_id, generation, pricing_date)
          VALUES ${batch.map(() => '(?,?,?,?)').join(',')}
          ON DUPLICATE KEY UPDATE generation = VALUES(generation), pricing_date = VALUES(pricing_date)`,
        batch.flatMap(row => [request.consumerId, row.variant_id, row.generation, pending.pricingDate]));
      }
      const [clock] = await connection.query<RowDataPacket[]>('SELECT UNIX_TIMESTAMP(UTC_TIMESTAMP(3))*1000 AS now_ms');
      const completedFullAt = pending.delivery.mode === 'full' ? Number(clock[0].now_ms) : Number(consumer.last_full_at);
      await connection.query(`UPDATE pos_catalogue_consumers SET initialized = 1, last_receipt = ?, pending_json = NULL,
        last_full_at = IF(?, ?, last_full_at) WHERE consumer_id = ?`,
      [request.ack, pending.delivery.mode === 'full', completedFullAt, request.consumerId]);
      if (pending.delivery.mode === 'full') await connection.query(
        'UPDATE pos_catalogue_control SET lease_owner = NULL, lease_until = NULL WHERE business_id = ? AND lease_owner = ?',
        [businessId, request.ack],
      );
      await connection.commit();
      return { acknowledged: true, completedFullAt, nextFullAt: nextCalendarMonth(completedFullAt, pending.delivery.timeZone) };
    }
    if (pending) {
      if (pending.delivery.mode === 'full') {
        const [lease] = await connection.query<RowDataPacket[]>(
          'SELECT lease_owner FROM pos_catalogue_control WHERE business_id = ? AND lease_owner = ? AND lease_until > UTC_TIMESTAMP(3)',
          [businessId, pending.delivery.receipt],
        );
        if (lease.length) {
          await connection.commit();
          return pending.delivery;
        }
        await connection.query('UPDATE pos_catalogue_consumers SET pending_json = NULL WHERE consumer_id = ?', [request.consumerId]);
      } else {
        await connection.commit();
        return pending.delivery;
      }
    }
    const full = request.full || !consumer.initialized;
    const receipt = randomUUID();
    if (full) {
      const [leases] = await connection.query<RowDataPacket[]>(
        'SELECT lease_owner, lease_until > UTC_TIMESTAMP(3) AS busy FROM pos_catalogue_control WHERE business_id = ? FOR UPDATE', [businessId],
      );
      if (leases[0]?.busy) {
        await connection.commit();
        return { protocol: 2, mode: 'deferred', retryAfterMs: 15_000 };
      }
      await connection.query(`UPDATE pos_catalogue_control SET lease_owner = ?, lease_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${LEASE_SECONDS} SECOND) WHERE business_id = ?`, [receipt, businessId]);
    }
    const settings = await catalogueSettings(connection, businessId, locationId);
    const [clock] = await connection.query<RowDataPacket[]>('SELECT UNIX_TIMESTAMP(UTC_TIMESTAMP(3))*1000 AS now_ms');
    const serverTime = Number(clock[0].now_ms);
    const pricingDate = new Date(serverTime).toLocaleDateString('sv-SE', { timeZone: settings.timeZone });
    const refreshIds = request.refreshIds ?? [];
    const [generations] = await connection.query<(RowDataPacket & Generation)[]>(
      `SELECT /*+ MAX_EXECUTION_TIME(30000) */ c.variant_id, c.generation FROM pos_catalogue_changes c
       LEFT JOIN pos_catalogue_acknowledgements a ON a.consumer_id = ? AND a.variant_id = c.variant_id
       LEFT JOIN ims_product_variants v ON v.variant_id = c.variant_id
       WHERE c.business_id = ? ${full ? '' : `AND (a.generation IS NULL OR a.generation <> c.generation
         OR (v.price_rrp_sale IS NOT NULL AND (a.pricing_date IS NULL OR a.pricing_date <> ?))
         ${refreshIds.length ? `OR c.variant_id IN (${refreshIds.map(() => '?').join(',')})` : ''})`}
       ORDER BY ${!full && refreshIds.length ? `c.variant_id IN (${refreshIds.map(() => '?').join(',')}) DESC,` : ''} c.variant_id ${full ? '' : `LIMIT ${BATCH_SIZE + 1}`}`,
      [request.consumerId, businessId, ...(full ? [] : [pricingDate, ...refreshIds, ...refreshIds])],
    );
    const more = !full && generations.length > BATCH_SIZE;
    const delivered = more ? generations.slice(0, BATCH_SIZE) : generations;
    const products = [];
    for (let offset = 0; offset < delivered.length; offset += BATCH_SIZE) {
      products.push(...await projectCatalogue(connection, businessId, locationId,
        delivered.slice(offset, offset + BATCH_SIZE).map(row => row.variant_id), pricingDate, settings.buildEnabled));
    }
    const activeIds = new Set(products.map(product => product.variant_id));
    const delivery: CatalogueDelivery = {
      protocol: 2, mode: full ? 'full' : 'delta', businessId, locationId,
      consumerId: request.consumerId, epoch: String(control.epoch), receipt, serverTime, timeZone: settings.timeZone,
      nextFullAt: nextCalendarMonth(full ? serverTime : Number(consumer.last_full_at), settings.timeZone),
      products, removed: full ? [] : delivered.filter(row => !activeIds.has(row.variant_id)).map(row => row.variant_id), more,
    };
    await connection.query('UPDATE pos_catalogue_consumers SET pending_json = ? WHERE consumer_id = ?',
      [JSON.stringify({ delivery, generations: delivered, pricingDate } satisfies Pending), request.consumerId]);
    if (full) await connection.query(`UPDATE pos_catalogue_control SET lease_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${LEASE_SECONDS} SECOND) WHERE business_id = ? AND lease_owner = ?`, [businessId, receipt]);
    await connection.commit();
    console.info('[pos-catalogue]', JSON.stringify({ mode: delivery.mode, count: products.length, removed: delivery.removed.length, more, serverMs: Date.now() - serverTime }));
    return delivery;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
