import 'server-only';

import { getPool, query } from '@/services/MySQLService';
import type { TyroPayRequestStatus, TyroWebhookEvent } from './payApi';

export interface TyroPayRequestRecord {
  id: string;
  businessId: string;
  purpose: string;
  sourceReference: string | null;
  orderId: string;
  tyroPayRequestId: string | null;
  locationId: string;
  amountCents: number;
  currencyCode: 'AUD';
  status: TyroPayRequestStatus | 'CREATING' | 'CREATE_FAILED';
}

function mapRequest(row: any): TyroPayRequestRecord {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    purpose: String(row.purpose),
    sourceReference: row.source_reference == null ? null : String(row.source_reference),
    orderId: String(row.order_id),
    tyroPayRequestId: row.tyro_pay_request_id == null ? null : String(row.tyro_pay_request_id),
    locationId: String(row.location_id),
    amountCents: Number(row.amount_cents),
    currencyCode: 'AUD',
    status: row.status,
  };
}

export const TyroPayRepository = {
  async createPending(input: {
    id: string;
    businessId: string;
    purpose: string;
    sourceReference?: string;
    orderId: string;
    locationId: string;
    amountCents: number;
    createdByUserId: number;
  }): Promise<void> {
    await getPool().execute(
      `INSERT INTO tyro_pay_requests
         (id, business_id, purpose, source_reference, order_id, location_id, amount_cents, currency_code, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'AUD', 'CREATING', ?)`,
      [input.id, input.businessId, input.purpose, input.sourceReference ?? null, input.orderId, input.locationId,
        input.amountCents, input.createdByUserId],
    );
  },

  async attachProviderRequest(input: {
    id: string;
    tyroPayRequestId: string;
    status: TyroPayRequestStatus;
  }): Promise<void> {
    await getPool().execute(
      `UPDATE tyro_pay_requests SET tyro_pay_request_id = ?, status = ?, safe_error = NULL WHERE id = ?`,
      [input.tyroPayRequestId, input.status, input.id],
    );
  },

  async markCreateFailed(id: string, error: unknown): Promise<void> {
    const safeError = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    await getPool().execute(
      `UPDATE tyro_pay_requests SET status = 'CREATE_FAILED', safe_error = ? WHERE id = ? AND status = 'CREATING'`,
      [safeError, id],
    );
  },

  async findByProviderRequestId(tyroPayRequestId: string): Promise<TyroPayRequestRecord | null> {
    const rows = await query<any>(
      `SELECT * FROM tyro_pay_requests WHERE tyro_pay_request_id = ? LIMIT 1`,
      [tyroPayRequestId],
    );
    return rows[0] ? mapRequest(rows[0]) : null;
  },

  async findById(id: string): Promise<TyroPayRequestRecord | null> {
    const rows = await query<any>(`SELECT * FROM tyro_pay_requests WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? mapRequest(rows[0]) : null;
  },

  async findByOrderId(orderId: string): Promise<TyroPayRequestRecord | null> {
    const rows = await query<any>(`SELECT * FROM tyro_pay_requests WHERE order_id = ? LIMIT 1`, [orderId]);
    return rows[0] ? mapRequest(rows[0]) : null;
  },

  async updateFromProvider(input: {
    id: string;
    tyroPayRequestId: string;
    status: TyroPayRequestStatus;
  }): Promise<void> {
    await getPool().execute(
      `UPDATE tyro_pay_requests SET tyro_pay_request_id = ?, status = ?, safe_error = NULL WHERE id = ?`,
      [input.tyroPayRequestId, input.status, input.id],
    );
  },

  async claimWebhookEvent(event: TyroWebhookEvent): Promise<boolean> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<any[]>(
        `SELECT id, status FROM tyro_pay_webhook_events
          WHERE event_type = ? AND resource_type = ? AND resource_id = ? LIMIT 1 FOR UPDATE`,
        [event.type, event.data.resource, event.data.id],
      );
      if (rows[0]?.status === 'processed' || rows[0]?.status === 'ignored') {
        await connection.commit();
        return false;
      }
      if (rows[0]) {
        await connection.execute(
          `UPDATE tyro_pay_webhook_events SET status = 'received', safe_error = NULL WHERE id = ?`,
          [rows[0].id],
        );
      } else {
        await connection.execute(
          `INSERT INTO tyro_pay_webhook_events (event_type, resource_type, resource_id, status)
           VALUES (?, ?, ?, 'received')`,
          [event.type, event.data.resource, event.data.id],
        );
      }
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async finishWebhookEvent(input: {
    event: TyroWebhookEvent;
    businessId?: string;
    ignored?: boolean;
    error?: unknown;
  }): Promise<void> {
    const safeError = input.error instanceof Error ? input.error.message.slice(0, 500)
      : input.error ? String(input.error).slice(0, 500) : null;
    const status = input.error ? 'failed' : input.ignored ? 'ignored' : 'processed';
    await getPool().execute(
      `UPDATE tyro_pay_webhook_events
          SET business_id = ?, status = ?, safe_error = ?, processed_at = ${input.error ? 'NULL' : 'UTC_TIMESTAMP(3)'}
        WHERE event_type = ? AND resource_type = ? AND resource_id = ?`,
      [input.businessId ?? null, status, safeError, input.event.type, input.event.data.resource, input.event.data.id],
    );
  },
};