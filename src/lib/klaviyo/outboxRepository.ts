import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import type { KlaviyoEventInput } from '@/services/KlaviyoService';
import { KLAVIYO_COMMERCE_EVENT_VERSION, type KlaviyoIntegrationSettings } from './contracts';

export interface EnqueueKlaviyoEventsInput {
  businessId: string;
  contactId: number;
  source: keyof KlaviyoIntegrationSettings['sources'];
  sourceId: string;
  events: KlaviyoEventInput[];
}

export interface KlaviyoOutboxRow {
  id: number;
  contactId: number;
  operationKey: string;
  source: keyof KlaviyoIntegrationSettings['sources'];
  sourceId: string;
  eventType: string;
  attempts: number;
  event: Omit<KlaviyoEventInput, 'profile'>;
}

interface OutboxDbRow {
  id: number;
  contact_id: number;
  operation_key: string;
  source_type: KlaviyoOutboxRow['source'];
  source_id: string;
  event_type: string;
  attempts: number;
  payload_json: string | Omit<KlaviyoEventInput, 'profile'>;
}

function mysqlDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Klaviyo event occurredAt must be a valid date.');
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

export async function enqueueKlaviyoEvents(input: EnqueueKlaviyoEventsInput): Promise<number> {
  const businessId = input.businessId.trim();
  const contactId = Math.floor(Number(input.contactId));
  const sourceId = input.sourceId.trim();
  if (!businessId || !Number.isInteger(contactId) || contactId <= 0 || !sourceId) {
    throw new Error('Business, contact and source identity are required for Klaviyo events.');
  }

  let inserted = 0;
  for (const event of input.events) {
    const { profile: _profile, ...storedEvent } = event;
    const result = await imsExecute(
      `INSERT IGNORE INTO ims_klaviyo_outbox
         (business_id, contact_id, operation_key, source_type, source_id,
          event_type, event_version, occurred_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        contactId,
        event.uniqueId,
        input.source,
        sourceId,
        event.metricName,
        KLAVIYO_COMMERCE_EVENT_VERSION,
        mysqlDateTime(event.occurredAt),
        JSON.stringify(storedEvent),
      ],
    );
    inserted += Number(result.affectedRows ?? 0);
  }
  return inserted;
}

export async function recoverStaleKlaviyoOutbox(businessId: string): Promise<number> {
  const result = await imsExecute(
    `UPDATE ims_klaviyo_outbox
        SET status = 'pending', locked_at = NULL, available_at = CURRENT_TIMESTAMP(3),
            safe_error = 'Recovered after an interrupted Klaviyo worker.'
      WHERE business_id = ? AND status = 'processing'
        AND locked_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE)`,
    [businessId],
  );
  return Number(result.affectedRows ?? 0);
}

export async function listPendingKlaviyoOutbox(businessId: string, limit = 25): Promise<KlaviyoOutboxRow[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await imsQuery<OutboxDbRow>(
    `SELECT id, contact_id, operation_key, source_type, source_id, event_type, attempts, payload_json
       FROM ims_klaviyo_outbox
      WHERE business_id = ? AND status = 'pending' AND available_at <= CURRENT_TIMESTAMP(3)
      ORDER BY available_at, id
      LIMIT ${safeLimit}`,
    [businessId],
  );
  return rows.map(row => ({
    id: Number(row.id),
    contactId: Number(row.contact_id),
    operationKey: row.operation_key,
    source: row.source_type,
    sourceId: row.source_id,
    eventType: row.event_type,
    attempts: Number(row.attempts ?? 0),
    event: typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json,
  }));
}

export async function claimKlaviyoOutbox(businessId: string, id: number): Promise<boolean> {
  const result = await imsExecute(
    `UPDATE ims_klaviyo_outbox
        SET status = 'processing', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP(3), safe_error = NULL
      WHERE business_id = ? AND id = ? AND status = 'pending'`,
    [businessId, id],
  );
  return Number(result.affectedRows ?? 0) === 1;
}

export async function completeKlaviyoOutbox(businessId: string, id: number, safeError: string | null = null): Promise<void> {
  await imsExecute(
    `UPDATE ims_klaviyo_outbox
        SET status = 'complete', completed_at = CURRENT_TIMESTAMP(3), locked_at = NULL, safe_error = ?
      WHERE business_id = ? AND id = ? AND status = 'processing'`,
    [safeError, businessId, id],
  );
}

export async function failKlaviyoOutbox(input: {
  businessId: string;
  id: number;
  retry: boolean;
  retryDelaySeconds: number;
  safeError: string;
}): Promise<void> {
  await imsExecute(
    `UPDATE ims_klaviyo_outbox
        SET status = ?, available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
            locked_at = NULL, safe_error = ?
      WHERE business_id = ? AND id = ? AND status = 'processing'`,
    [input.retry ? 'pending' : 'dead_letter', input.retryDelaySeconds, input.safeError, input.businessId, input.id],
  );
}