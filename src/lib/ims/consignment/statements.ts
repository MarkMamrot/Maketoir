import { createHash } from 'crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, query } from './db';
import { ACCOUNTING_GUIDANCE, assertTransition, ConsignmentError, eventFingerprint, projectActivity, requireDate, requireId, requirePeriod, requireText, type ConsignmentEvent, type StatementStatus } from './domain';
import { requireTracking } from './tracking';

export interface Statement {
  id: number; business_id: string; supplier_id: number; tracking_interval_id: number;
  number: string; period_from: string; period_to: string; status: StatementStatus;
  version: number; include_carry_forward: number; snapshot_json: unknown; total: number;
}
interface Snapshot {
  events: ConsignmentEvent[]; fingerprint: string; supplier: { id: number; name: string; company?: string };
  business: { name: string }; guidance: string;
}
function snapshot(value: unknown): Snapshot { return (typeof value === 'string' ? JSON.parse(value) : value) as Snapshot; }
async function audit(db: PoolConnection, businessId: string, id: number, actorId: number | null, action: string, details: unknown) {
  await execute(db, 'INSERT INTO ims_consignment_statement_audit (business_id,statement_id,actor_id,action,details_json) VALUES (?,?,?,?,?)', [businessId, id, actorId, action, JSON.stringify(details)]);
}
export async function activity(db: PoolConnection, businessId: string, input: URLSearchParams) {
  const { from, to } = requirePeriod(input.get('from'), input.get('to'));
  const conditions = ['business_id=?', 'event_date BETWEEN ? AND ?']; const values: unknown[] = [businessId, from, to];
  for (const [key, column] of [['supplierId', 'supplier_id'], ['locationId', 'location_id']] as const) {
    if (input.get(key)) { conditions.push(`${column}=?`); values.push(requireId(input.get(key), key)); }
  }
  if (input.get('channel')) { conditions.push('channel=?'); values.push(requireText(input.get('channel'), 'Channel', 100)); }
  const events = await query<ConsignmentEvent>(db, `SELECT *,DATE_FORMAT(event_date,'%Y-%m-%d') event_date FROM ims_consignment_events WHERE ${conditions.join(' AND ')} ORDER BY event_date,id`, values);
  return projectActivity(events);
}
export async function listStatements(db: PoolConnection, businessId: string, supplierId?: string | null) {
  return query<Statement>(db, `SELECT id,number,supplier_id,tracking_interval_id,DATE_FORMAT(period_from,'%Y-%m-%d') period_from,DATE_FORMAT(period_to,'%Y-%m-%d') period_to,status,version,currency,subtotal,tax,total,accounting_reference,accounting_date,created_at FROM ims_consignment_statements WHERE business_id=? ${supplierId ? 'AND supplier_id=?' : ''} ORDER BY id DESC`, supplierId ? [businessId, requireId(supplierId)] : [businessId]);
}
export async function statementDetail(db: PoolConnection, businessId: string, id: number, lock = false) {
  const [statement] = await query<Statement>(db, `SELECT *,DATE_FORMAT(period_from,'%Y-%m-%d') period_from,DATE_FORMAT(period_to,'%Y-%m-%d') period_to FROM ims_consignment_statements WHERE business_id=? AND id=? ${lock ? 'FOR UPDATE' : ''}`, [businessId, id]);
  if (!statement) throw new ConsignmentError('Statement not found.', 404);
  const saved = snapshot(statement.snapshot_json);
  const audits = await query(db, 'SELECT id,actor_id,action,details_json,created_at FROM ims_consignment_statement_audit WHERE business_id=? AND statement_id=? ORDER BY id', [businessId, id]);
  const deliveries = await query(db, 'SELECT id,recipient,status,provider_reference,created_at,updated_at FROM ims_consignment_deliveries WHERE business_id=? AND statement_id=? ORDER BY id', [businessId, id]);
  const earlier = statement.status === 'Draft' ? await query<ConsignmentEvent>(db,
    "SELECT *,DATE_FORMAT(event_date,'%Y-%m-%d') event_date FROM ims_consignment_events WHERE business_id=? AND supplier_id=? AND tracking_interval_id=? AND statement_id IS NULL AND source_type<>'supplier_return' AND event_date<? ORDER BY event_date,id",
    [businessId, statement.supplier_id, statement.tracking_interval_id, statement.period_from]) : [];
  return {
    statement: { ...statement, snapshot_json: saved }, events: saved.events, projection: projectActivity(saved.events),
    priorUnallocated: { ...projectActivity(earlier), includedInDraft: Boolean(statement.include_carry_forward) },
    audit: audits, deliveries,
  };
}
async function eligibleEvents(db: PoolConnection, businessId: string, supplierId: number, intervalId: number, from: string, to: string, carry: boolean) {
  return query<ConsignmentEvent>(db,
    `SELECT *,DATE_FORMAT(event_date,'%Y-%m-%d') event_date FROM ims_consignment_events
     WHERE business_id=? AND supplier_id=? AND tracking_interval_id=? AND statement_id IS NULL
     AND source_type<>'supplier_return' AND event_date<=? ${carry ? '' : 'AND event_date>=?'}
     ORDER BY event_date,id FOR UPDATE`, carry ? [businessId, supplierId, intervalId, to] : [businessId, supplierId, intervalId, to, from]);
}
export async function createStatement(db: PoolConnection, businessId: string, actorId: number | null, businessName: string, body: Record<string, unknown>) {
  const { interval } = await requireTracking(db, businessId);
  const { from, to } = requirePeriod(body.from, body.to);
  if (from < interval.cutover_date) throw new ConsignmentError('Statement period cannot precede the active cutover.');
  const supplierId = requireId(body.supplierId, 'Supplier');
  if (body.includeCarryForward !== undefined && typeof body.includeCarryForward !== 'boolean') throw new ConsignmentError('includeCarryForward must be a boolean.');
  const [supplier] = await query<{ id: number; name: string; company?: string }>(db, "SELECT id,name,company FROM ims_contacts WHERE business_id=? AND id=? AND is_consignment=1 AND type IN ('supplier','both')", [businessId, supplierId]);
  if (!supplier) throw new ConsignmentError('Choose a current consignment supplier.');
  let correctionAudit: Record<string, unknown> | null = null;
  if (body.correction !== undefined) {
    const correction = body.correction as Record<string, unknown>;
    if (!correction || typeof correction !== 'object') throw new ConsignmentError('Invalid correction.');
    const originalId = requireId(correction.originalEventId, 'Original event');
    const [original] = await query<ConsignmentEvent & { original_status: string }>(db,
      "SELECT e.*,s.status original_status FROM ims_consignment_events e JOIN ims_consignment_statements s ON s.id=e.statement_id AND s.business_id=e.business_id WHERE e.business_id=? AND e.id=? AND e.supplier_id=? FOR UPDATE", [businessId, originalId, supplierId]);
    if (!original || original.original_status !== 'Accounted' || original.source_type === 'supplier_return') throw new ConsignmentError('Corrections require a linked accounted financial source.');
    if (original.tracking_interval_id !== interval.id) throw new ConsignmentError('Cross-cutover corrections require external bookkeeper review.');
    const quantity = Number(correction.quantity);
    if (!Number.isFinite(quantity) || quantity === 0 || Math.abs(quantity) > Math.abs(Number(original.quantity)) || !/^-?\d+(\.\d{1,6})?$/.test(String(correction.quantity))) throw new ConsignmentError('Correction quantity must be nonzero, at most the original quantity, with up to six decimals.');
    const reason = requireText(correction.reason, 'Correction reason');
    const reference = requireText(correction.evidenceReference, 'Evidence reference', 255);
    correctionAudit = { originalEventId: originalId, quantity, reason, evidenceReference: reference };
    const key = `correction:${originalId}:${createHash('sha256').update(reference.toLowerCase()).digest('hex')}`;
    const prior = await query(db, 'SELECT id FROM ims_consignment_events WHERE business_id=? AND event_key=?', [businessId, key]);
    if (prior.length) throw new ConsignmentError('This evidence-backed correction has already been recorded.', 409);
    const [existing] = await query<{ qty: string }>(db, "SELECT COALESCE(SUM(quantity),0) qty FROM ims_consignment_events WHERE business_id=? AND original_event_id=? AND source_type='correction'", [businessId, originalId]);
    if (Math.abs(Number(existing.qty) + quantity) > Math.abs(Number(original.quantity))) throw new ConsignmentError('Cumulative corrections exceed the original source quantity.');
    await execute(db, `INSERT INTO ims_consignment_events
      (business_id,supplier_id,source_type,source_id,source_line_id,event_key,original_event_id,variant_id,sku,product_name,location_id,channel,event_date,quantity,unit_cost,tax_rate,tracking_interval_id,evidence_reference)
      VALUES (?,?,'correction',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId, supplierId, String(originalId), String(originalId), key, originalId, original.variant_id, original.sku, original.product_name, original.location_id, original.channel, from, quantity, original.unit_cost, original.tax_rate, interval.id, `${reference}: ${reason}`.slice(0, 255)]);
  }
  const events = await eligibleEvents(db, businessId, supplierId, interval.id, from, to, body.includeCarryForward === true);
  if (!events.length) throw new ConsignmentError('No unallocated tracked financial activity in this period.');
  const projection = projectActivity(events);
  const [businessSettings] = await query<{ value: string }>(db, "SELECT value FROM ims_settings WHERE business_id=? AND `key`='business_name'", [businessId]);
  const saved: Snapshot = { events, fingerprint: eventFingerprint(events), supplier, business: { name: businessSettings?.value || businessName }, guidance: ACCOUNTING_GUIDANCE };
  const result = await execute(db, `INSERT INTO ims_consignment_statements
    (business_id,supplier_id,tracking_interval_id,period_from,period_to,include_carry_forward,snapshot_json,subtotal,tax,total,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [businessId, supplierId, interval.id, from, to, body.includeCarryForward === true ? 1 : 0, JSON.stringify(saved), projection.totals.subtotal, projection.totals.tax, projection.totals.total, actorId]);
  await execute(db, 'UPDATE ims_consignment_statements SET number=? WHERE business_id=? AND id=?', [`CS-${result.insertId}`, businessId, result.insertId]);
  await audit(db, businessId, result.insertId, actorId, 'Created', { includeCarryForward: body.includeCarryForward === true, correction: correctionAudit });
  return statementDetail(db, businessId, result.insertId);
}
export async function mutateStatement(db: PoolConnection, businessId: string, actorId: number | null, id: number, body: Record<string, unknown>) {
  const { interval } = await requireTracking(db, businessId);
  const detail = await statementDetail(db, businessId, id, true);
  const { statement } = detail;
  if (statement.tracking_interval_id !== interval.id) throw new ConsignmentError('Statement belongs to a closed tracking interval.', 409);
  if (body.version !== statement.version) throw new ConsignmentError('Statement changed; reload before retrying.', 409);
  const action = requireText(body.action, 'Action', 30);
  assertTransition(statement.status, action);
  const saved = snapshot(statement.snapshot_json);
  let nextStatus = statement.status;
  if (action === 'refresh' || action === 'finalise') {
    const events = await eligibleEvents(db, businessId, statement.supplier_id, interval.id, statement.period_from, statement.period_to, Boolean(statement.include_carry_forward));
    if (action === 'finalise' && eventFingerprint(events) !== saved.fingerprint) throw new ConsignmentError('Preview is stale or claimed by another statement. Refresh and review before finalising.', 409);
    if (!events.length) throw new ConsignmentError('There is no eligible unallocated activity.', 409);
    const projection = projectActivity(events);
    if (action === 'finalise' && projection.exceptions.length) throw new ConsignmentError('Resolve missing cost/tax, ownership, or cross-cutover exceptions before finalising.', 409);
    saved.events = events; saved.fingerprint = eventFingerprint(events);
    await execute(db, 'UPDATE ims_consignment_statements SET snapshot_json=?,subtotal=?,tax=?,total=? WHERE business_id=? AND id=?', [JSON.stringify(saved), projection.totals.subtotal, projection.totals.tax, projection.totals.total, businessId, id]);
    if (action === 'finalise') {
      const claimed = await execute(db, `UPDATE ims_consignment_events SET statement_id=? WHERE business_id=? AND statement_id IS NULL AND id IN (${events.map(() => '?').join(',')})`, [id, businessId, ...events.map(event => event.id)]);
      if (claimed.affectedRows !== events.length) throw new ConsignmentError('Source claim conflict; reload the statement.', 409);
      nextStatus = 'Finalised';
    }
  } else if (action === 'account') {
    const reference = requireText(body.accountingReference, 'Accounting reference', 255);
    const date = requireDate(body.accountingDate, 'Accounting date');
    await execute(db, 'UPDATE ims_consignment_statements SET accounting_reference=?,accounting_date=? WHERE business_id=? AND id=?', [reference, date, businessId, id]);
    nextStatus = 'Accounted';
  } else if (action === 'cancel') {
    const reason = requireText(body.reason, 'Cancellation reason');
    const pending = await query(db, "SELECT id FROM ims_consignment_deliveries WHERE business_id=? AND statement_id=? AND status IN ('Sending','Unconfirmed')", [businessId, id]);
    if (pending.length) throw new ConsignmentError('Review unresolved delivery outcomes before cancellation.', 409);
    await execute(db, 'UPDATE ims_consignment_events SET statement_id=NULL WHERE business_id=? AND statement_id=?', [businessId, id]);
    await audit(db, businessId, id, actorId, 'CancellationWarning', { reason, notifySupplierAndBookkeeper: detail.deliveries.length > 0, accountingReference: (statement as unknown as Record<string, unknown>).accounting_reference ?? null });
    nextStatus = 'Cancelled';
  }
  await execute(db, 'UPDATE ims_consignment_statements SET status=?,version=version+1 WHERE business_id=? AND id=?', [nextStatus, businessId, id]);
  await audit(db, businessId, id, actorId, action, { previousStatus: statement.status, status: nextStatus, reason: body.reason ?? null, accountingReference: body.accountingReference ?? null, accountingDate: body.accountingDate ?? null });
  return statementDetail(db, businessId, id);
}
