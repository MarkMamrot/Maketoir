import type { PoolConnection } from 'mysql2/promise';
import { execute, query } from './db';
import { CONSIGNMENT_TRACKING_KEY, ConsignmentError, localDate, projectActivity, requireDate, requireText, type ConsignmentEvent } from './domain';

export interface TrackingState { business_id: string; enabled: number; evidence_from: string | null; active_interval_id: number | null }
export interface TrackingInterval { id: number; cutover_date: string; disabled_at: string | null }
export async function lockTrackingState(db: PoolConnection, businessId: string): Promise<TrackingState> {
  await execute(db, 'INSERT IGNORE INTO ims_consignment_tracking_state (business_id) VALUES (?)', [businessId]);
  const [state] = await query<TrackingState>(db,
    'SELECT business_id,enabled,DATE_FORMAT(evidence_from,\'%Y-%m-%d\') evidence_from,active_interval_id FROM ims_consignment_tracking_state WHERE business_id=? FOR UPDATE', [businessId]);
  return state;
}
/** Must be called inside the source transaction, before inserting immutable facts. */
export async function getTrackingInterval(db: PoolConnection, businessId: string, eventDate: string): Promise<number | null> {
  requireDate(eventDate);
  const state = await lockTrackingState(db, businessId);
  await execute(db, 'UPDATE ims_consignment_tracking_state SET evidence_from=LEAST(COALESCE(evidence_from,?),?) WHERE business_id=?', [eventDate, eventDate, businessId]);
  if (!state.enabled || !state.active_interval_id) return null;
  const [interval] = await query<TrackingInterval>(db, "SELECT id,DATE_FORMAT(cutover_date,'%Y-%m-%d') cutover_date,disabled_at FROM ims_consignment_tracking_intervals WHERE business_id=? AND id=?", [businessId, state.active_interval_id]);
  return interval && !interval.disabled_at && eventDate >= interval.cutover_date ? interval.id : null;
}
export async function requireTracking(db: PoolConnection, businessId: string) {
  const state = await lockTrackingState(db, businessId);
  if (!state.enabled || !state.active_interval_id) throw new ConsignmentError('Consignment settlement tracking is off. Activity reporting remains available.', 409);
  const [interval] = await query<TrackingInterval>(db, "SELECT id,DATE_FORMAT(cutover_date,'%Y-%m-%d') cutover_date,disabled_at FROM ims_consignment_tracking_intervals WHERE id=? AND business_id=?", [state.active_interval_id, businessId]);
  if (!interval || interval.disabled_at) throw new ConsignmentError('Tracking interval is closed.', 409);
  return { state, interval };
}
export async function trackingOverview(db: PoolConnection, businessId: string) {
  const state = await lockTrackingState(db, businessId);
  const intervals = await query<TrackingInterval>(db, "SELECT *,DATE_FORMAT(cutover_date,'%Y-%m-%d') cutover_date FROM ims_consignment_tracking_intervals WHERE business_id=? ORDER BY id DESC", [businessId]);
  const pending = await query<{ id: number; status: string }>(db, "SELECT id,status FROM ims_consignment_statements WHERE business_id=? AND status IN ('Draft','Finalised')", [businessId]);
  const deliveries = await query<{ id: number }>(db, "SELECT id FROM ims_consignment_deliveries WHERE business_id=? AND status IN ('Sending','Unconfirmed')", [businessId]);
  const events = state.active_interval_id ? await query<ConsignmentEvent>(db,
    "SELECT *,DATE_FORMAT(event_date,'%Y-%m-%d') event_date FROM ims_consignment_events WHERE business_id=? AND tracking_interval_id=? AND statement_id IS NULL AND source_type<>'supplier_return' ORDER BY id", [businessId, state.active_interval_id]) : [];
  const handover = projectActivity(events);
  return {
    enabled: Boolean(state.enabled), evidenceFrom: state.evidence_from,
    interval: intervals.find(row => row.id === state.active_interval_id) ?? null, intervals,
    blockers: [...pending.map(row => `Statement ${row.id} is ${row.status}; account or cancel it first.`), ...deliveries.map(row => `Delivery ${row.id} has an unresolved sending outcome.`)],
    handover: { eventCount: events.length, ...handover.totals, exceptions: handover.exceptions },
  };
}
export async function transitionTracking(db: PoolConnection, businessId: string, actorId: number | null, body: Record<string, unknown>) {
  const state = await lockTrackingState(db, businessId);
  if (typeof body.enabled !== 'boolean') throw new ConsignmentError('enabled must be a boolean.');
  if (Boolean(state.enabled) === body.enabled) throw new ConsignmentError('Tracking state has already changed; reload before retrying.', 409);
  if (body.enabled) {
    const cutoverDate = requireDate(body.cutoverDate, 'Cutover date');
    if (body.acknowledgeExternal !== true) throw new ConsignmentError('Acknowledge that earlier activity is managed externally.');
    const [settings] = await query<{ value: string }>(db, "SELECT value FROM ims_settings WHERE business_id=? AND `key`='business_timezone'", [businessId]);
    const timeZone = settings?.value || 'Australia/Sydney';
    const today = localDate(new Date(), timeZone);
    if (cutoverDate > today) throw new ConsignmentError('Cutover cannot be in the future.');
    // Before the first captured event, only today is reliable; never turn historical ownership into a backlog.
    if (cutoverDate < (state.evidence_from ?? today)) throw new ConsignmentError('Cutover predates reliable captured consignment evidence.');
    const [previous] = await query<{ disabled_at: string }>(db,
      "SELECT DATE_FORMAT(disabled_at,'%Y-%m-%dT%H:%i:%sZ') disabled_at FROM ims_consignment_tracking_intervals WHERE business_id=? AND disabled_at IS NOT NULL ORDER BY id DESC LIMIT 1", [businessId]);
    // Event dates have day resolution: do not ambiguously replay the day of the previous handover.
    if (previous && cutoverDate <= localDate(new Date(previous.disabled_at), timeZone)) throw new ConsignmentError('Re-enable with a cutover after the previous handover date.');
    const result = await execute(db, 'INSERT INTO ims_consignment_tracking_intervals (business_id,cutover_date,enabled_by) VALUES (?,?,?)', [businessId, cutoverDate, actorId]);
    await execute(db, 'UPDATE ims_consignment_tracking_state SET enabled=1,active_interval_id=? WHERE business_id=?', [result.insertId, businessId]);
  } else {
    const overview = await trackingOverview(db, businessId);
    if (overview.blockers.length) throw new ConsignmentError(overview.blockers.join(' '), 409);
    if (body.acknowledgeHandover !== true) throw new ConsignmentError('Acknowledge that remaining tracked obligations will be handled externally.');
    const reason = requireText(body.reason, 'Handover reason');
    await execute(db, 'UPDATE ims_consignment_tracking_intervals SET disabled_at=UTC_TIMESTAMP(6),disabled_by=?,disable_reason=?,handover_json=? WHERE business_id=? AND id=? AND disabled_at IS NULL',
      [actorId, reason, JSON.stringify(overview.handover), businessId, state.active_interval_id]);
    await execute(db, 'UPDATE ims_consignment_tracking_state SET enabled=0,active_interval_id=NULL WHERE business_id=?', [businessId]);
  }
  await execute(db, 'INSERT INTO ims_settings (business_id,`key`,`value`) VALUES (?,?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)', [businessId, CONSIGNMENT_TRACKING_KEY, body.enabled ? 'yes' : 'no']);
  return trackingOverview(db, businessId);
}
