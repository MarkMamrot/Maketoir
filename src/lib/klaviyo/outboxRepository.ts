import { imsExecute } from '@/services/IMSMySQLService';
import type { KlaviyoEventInput } from '@/services/KlaviyoService';
import { KLAVIYO_COMMERCE_EVENT_VERSION, type KlaviyoIntegrationSettings } from './contracts';

export interface EnqueueKlaviyoEventsInput {
  businessId: string;
  contactId: number;
  source: keyof KlaviyoIntegrationSettings['sources'];
  sourceId: string;
  events: KlaviyoEventInput[];
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