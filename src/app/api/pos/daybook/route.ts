import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  canTransitionDiscrepancy,
  canTransitionNeed,
  canTransitionRequest,
  normalizeStaffIdentity,
  parseDaybookDate,
} from '@/lib/pos/daybookService';
import type { DaybookDiscrepancyStatus, DaybookNeedStatus, DaybookRequestStatus } from '@/lib/pos/daybookTypes';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

const MANAGER_TIERS = new Set(['PosManager', 'StandardUser', 'Admin', 'SuperAdmin']);
const RECORD_TYPES = new Set(['customer_request', 'store_need', 'stock_discrepancy', 'incident']);

type DaybookContext = {
  businessId: string;
  locationId: number;
  locationName: string;
  actorUserId: number | null;
  actorName: string;
  actorTier: string;
  isManager: boolean;
};

async function resolveContext(): Promise<DaybookContext | null> {
  const session = await getImsSession(['pos_session', 'marketoir_session']);
  if (!session?.businessId) return null;
  const raw = session as typeof session & { location_id?: number; location_name?: string; full_name?: string; username?: string };
  const locationId = Number(raw.location_id ?? 0);
  if (!Number.isInteger(locationId) || locationId <= 0) return null;
  const locations = await imsQuery<{ id: number; name: string }>(
    'SELECT id, name FROM ims_locations WHERE business_id = ? AND id = ? AND is_active = 1 LIMIT 1',
    [session.businessId, locationId],
  );
  if (!locations[0]) return null;
  const actorTier = String(session.tier ?? session.role ?? 'PosUser');
  return {
    businessId: session.businessId,
    locationId,
    locationName: locations[0].name,
    actorUserId: Number(session.pos_user_id ?? session.userId ?? 0) || null,
    actorName: String(raw.full_name ?? session.name ?? raw.username ?? session.email ?? 'Staff').slice(0, 255),
    actorTier,
    isManager: MANAGER_TIERS.has(actorTier),
  };
}

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function jsonDetails(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

async function validateLocation(businessId: string, locationId: number): Promise<boolean> {
  const rows = await imsQuery<{ id: number }>(
    'SELECT id FROM ims_locations WHERE business_id = ? AND id = ? AND is_active = 1 LIMIT 1',
    [businessId, locationId],
  );
  return Boolean(rows[0]);
}

async function materializeTasks(context: DaybookContext, taskDate: string) {
  await imsExecute(
    `INSERT IGNORE INTO pos_daybook_task_instances
       (business_id, location_id, task_date, template_id, title_snapshot, instructions_snapshot, phase)
     SELECT business_id, location_id, ?, id, title, instructions, phase
     FROM pos_daybook_task_templates
     WHERE business_id = ? AND location_id = ? AND is_active = 1
       AND (effective_from IS NULL OR effective_from <= ?)
       AND (effective_to IS NULL OR effective_to >= ?)
       AND (
         recurrence = 'daily'
         OR (recurrence = 'weekly' AND weekday = DAYOFWEEK(?) - 1)
         OR (recurrence = 'once' AND scheduled_date = ?)
       )`,
    [taskDate, context.businessId, context.locationId, taskDate, taskDate, taskDate, taskDate],
  );
}

export async function GET(request: Request) {
  const context = await resolveContext();
  if (!context) return error('An active POS location is required.', 401);
  const url = new URL(request.url);
  const taskDate = parseDaybookDate(url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10));
  const staffInitials = String(url.searchParams.get('initials') ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
  if (!taskDate) return error('A valid date is required.');

  try {
    await materializeTasks(context, taskDate);
    const [tasks, communications, records, references, guides, staff, locations] = await Promise.all([
      imsQuery(
        `SELECT i.*, s.staff_name AS last_staff_name, s.staff_initials AS last_staff_initials,
                s.actor_name AS last_actor_name, s.created_at AS signed_at
         FROM pos_daybook_task_instances i
         LEFT JOIN pos_daybook_task_signoffs s ON s.id = (
           SELECT s2.id FROM pos_daybook_task_signoffs s2
           WHERE s2.business_id = i.business_id AND s2.instance_id = i.id ORDER BY s2.id DESC LIMIT 1
         )
         WHERE i.business_id = ? AND i.location_id = ? AND i.task_date = ?
         ORDER BY FIELD(i.phase, 'opening','during_day','closing'), i.id`,
        [context.businessId, context.locationId, taskDate],
      ),
      imsQuery(
        `SELECT c.*,
                (SELECT COUNT(*) FROM pos_daybook_communication_reads r
                 WHERE r.business_id = c.business_id AND r.communication_id = c.id) AS read_count,
                (SELECT COUNT(*) FROM pos_daybook_communication_reads mine
                 WHERE mine.business_id = c.business_id AND mine.communication_id = c.id
                   AND mine.location_id = ? AND mine.staff_initials = ?) AS my_read
         FROM pos_daybook_communications c
         JOIN pos_daybook_communication_targets t ON t.business_id = c.business_id AND t.communication_id = c.id
         WHERE c.business_id = ? AND t.location_id = ? AND c.archived_at IS NULL
           AND (c.expires_at IS NULL OR c.expires_at >= NOW())
         ORDER BY c.is_pinned DESC, c.published_at DESC LIMIT 100`,
        [context.locationId, staffInitials, context.businessId, context.locationId],
      ),
      imsQuery(
        `SELECT * FROM pos_daybook_records
         WHERE business_id = ? AND (location_id = ? OR source_location_id = ? OR destination_location_id = ?)
         ORDER BY created_at DESC LIMIT 500`,
        [context.businessId, context.locationId, context.locationId, context.locationId],
      ),
      imsQuery(
        `SELECT * FROM pos_daybook_references
         WHERE business_id = ? AND is_active = 1 AND (location_id IS NULL OR location_id = ?)
         ORDER BY category, sort_order, title`,
        [context.businessId, context.locationId],
      ),
      imsQuery(
        `SELECT * FROM pos_daybook_product_guides
         WHERE business_id = ? AND status <> 'archived' AND (location_id IS NULL OR location_id = ?)
         ORDER BY category, sort_order, product_name`,
        [context.businessId, context.locationId],
      ),
      imsQuery(
        `SELECT id, name, initials FROM pos_daybook_staff_identities
         WHERE business_id = ? AND location_id = ? AND is_active = 1 ORDER BY name`,
        [context.businessId, context.locationId],
      ),
      imsQuery('SELECT id, name, has_wholesale FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name', [context.businessId]),
    ]);
    return NextResponse.json({
      date: taskDate,
      location: { id: context.locationId, name: context.locationName },
      permissions: { manager: context.isManager },
      tasks,
      communications,
      records,
      references,
      guides,
      staff,
      locations,
    });
  } catch (caught) {
    await reportRuntimeIssue({
      businessId: context.businessId,
      source: 'pos/daybook',
      operation: 'load_workspace',
      title: 'Store Daybook workspace failed to load',
      error: caught,
      context: { locationId: context.locationId, taskDate },
    });
    return error('Store Daybook could not be loaded.', 500);
  }
}

export async function POST(request: Request) {
  const context = await resolveContext();
  if (!context) return error('An active POS location is required.', 401);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return error('Invalid JSON.'); }
  const action = String(body.action ?? '');

  try {
    if (action === 'save_identity') {
      const staff = normalizeStaffIdentity({ name: String(body.name ?? ''), initials: String(body.initials ?? '') });
      await imsExecute(
        `INSERT INTO pos_daybook_staff_identities (business_id, location_id, name, initials)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
        [context.businessId, context.locationId, staff.name, staff.initials],
      );
      const rows = await imsQuery<{ id: number }>(
        'SELECT id FROM pos_daybook_staff_identities WHERE business_id = ? AND location_id = ? AND initials = ? LIMIT 1',
        [context.businessId, context.locationId, staff.initials],
      );
      return NextResponse.json({ success: true, staff: { ...staff, id: rows[0]?.id } });
    }

    const staff = normalizeStaffIdentity({
      id: Number(body.staff_identity_id ?? 0) || null,
      name: String(body.staff_name ?? ''),
      initials: String(body.staff_initials ?? ''),
    });

    if (action === 'sign_task') {
      const instanceId = Number(body.instance_id ?? 0);
      const requestedAction = body.signoff_action === 'reopened' ? 'reopened' : 'completed';
      if (requestedAction === 'reopened' && !context.isManager) return error('Manager access is required.', 403);
      const instances = await imsQuery<{ id: number }>(
        'SELECT id FROM pos_daybook_task_instances WHERE id = ? AND business_id = ? AND location_id = ? LIMIT 1',
        [instanceId, context.businessId, context.locationId],
      );
      if (!instances[0]) return error('Task not found.', 404);
      await imsExecute(
        `INSERT INTO pos_daybook_task_signoffs
           (business_id, instance_id, action, staff_identity_id, staff_name, staff_initials,
            actor_user_id, actor_name, actor_tier, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, instanceId, requestedAction, staff.id, staff.name, staff.initials,
          context.actorUserId, context.actorName, context.actorTier, String(body.reason ?? '').trim().slice(0, 500) || null],
      );
      await imsExecute(
        `UPDATE pos_daybook_task_instances SET status = ?, completed_at = ${requestedAction === 'completed' ? 'NOW()' : 'NULL'}
         WHERE id = ? AND business_id = ?`,
        [requestedAction === 'completed' ? 'completed' : 'open', instanceId, context.businessId],
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'read_communication') {
      const communicationId = Number(body.communication_id ?? 0);
      const rows = await imsQuery<{ id: number }>(
        `SELECT c.id FROM pos_daybook_communications c
         JOIN pos_daybook_communication_targets t ON t.business_id = c.business_id AND t.communication_id = c.id
         WHERE c.id = ? AND c.business_id = ? AND t.location_id = ? LIMIT 1`,
        [communicationId, context.businessId, context.locationId],
      );
      if (!rows[0]) return error('Communication not found.', 404);
      await imsExecute(
        `INSERT IGNORE INTO pos_daybook_communication_reads
           (business_id, communication_id, location_id, staff_identity_id, staff_name, staff_initials, actor_user_id, actor_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, communicationId, context.locationId, staff.id, staff.name, staff.initials, context.actorUserId, context.actorName],
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'create_record') {
      const recordType = String(body.record_type ?? '');
      if (!RECORD_TYPES.has(recordType)) return error('Invalid record type.');
      const destinationLocationId = Number(body.destination_location_id ?? 0) || null;
      if (destinationLocationId && !(await validateLocation(context.businessId, destinationLocationId))) return error('Destination location not found.');
      const details = jsonDetails(body.details);
      if (recordType === 'stock_discrepancy') {
        const system = Number(details.system_quantity);
        const physical = Number(details.physical_quantity);
        if (Number.isFinite(system) && Number.isFinite(physical)) details.variance = physical - system;
      }
      const title = String(body.title ?? '').trim().slice(0, 255);
      if (!title) return error('A title is required.');
      const result = await imsExecute(
        `INSERT INTO pos_daybook_records
           (business_id, location_id, record_type, status, occurred_on, title, details_json,
            source_location_id, destination_location_id, staff_identity_id, staff_name, staff_initials,
            actor_user_id, actor_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, context.locationId, recordType, recordType === 'store_need' ? 'requested' : 'open',
          parseDaybookDate(String(body.occurred_on ?? '')), title, JSON.stringify(details), context.locationId,
          destinationLocationId, staff.id, staff.name, staff.initials, context.actorUserId, context.actorName],
      );
      return NextResponse.json({ success: true, id: result.insertId });
    }

    if (action === 'transition_record') {
      const recordId = Number(body.record_id ?? 0);
      const rows = await imsQuery<{ id: number; record_type: string; status: string; location_id: number; source_location_id: number | null; destination_location_id: number | null }>(
        `SELECT id, record_type, status, location_id, source_location_id, destination_location_id
         FROM pos_daybook_records WHERE id = ? AND business_id = ? LIMIT 1`,
        [recordId, context.businessId],
      );
      const record = rows[0];
      if (!record || ![record.location_id, record.source_location_id, record.destination_location_id].includes(context.locationId)) return error('Record not found.', 404);
      const toStatus = String(body.status ?? '');
      const allowed = record.record_type === 'store_need'
        ? canTransitionNeed(record.status as DaybookNeedStatus, toStatus as DaybookNeedStatus)
        : record.record_type === 'customer_request'
          ? canTransitionRequest(record.status as DaybookRequestStatus, toStatus as DaybookRequestStatus)
          : record.record_type === 'stock_discrepancy'
            ? context.isManager && canTransitionDiscrepancy(record.status as DaybookDiscrepancyStatus, toStatus as DaybookDiscrepancyStatus)
            : context.isManager && ['submitted', 'reviewed', 'closed'].includes(toStatus);
      if (!allowed) return error('That status change is not allowed.', 409);
      await imsExecute(
        `INSERT INTO pos_daybook_record_events
           (business_id, record_id, from_status, to_status, note, staff_identity_id, staff_name,
            staff_initials, actor_user_id, actor_name, actor_tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, recordId, record.status, toStatus, String(body.note ?? '').trim() || null,
          staff.id, staff.name, staff.initials, context.actorUserId, context.actorName, context.actorTier],
      );
      await imsExecute(
        `UPDATE pos_daybook_records SET status = ?, resolved_at = IF(? IN ('fulfilled','received','cancelled','closed'), NOW(), NULL)
         WHERE id = ? AND business_id = ?`,
        [toStatus, toStatus, recordId, context.businessId],
      );
      return NextResponse.json({ success: true });
    }

    if (!context.isManager) return error('Manager access is required.', 403);

    if (action === 'create_task') {
      const recurrence = ['daily', 'weekly', 'once'].includes(String(body.recurrence)) ? String(body.recurrence) : 'daily';
      const phase = ['opening', 'during_day', 'closing'].includes(String(body.phase)) ? String(body.phase) : 'during_day';
      await imsExecute(
        `INSERT INTO pos_daybook_task_templates
           (business_id, location_id, phase, title, instructions, recurrence, weekday, scheduled_date, sort_order, created_by_id, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, context.locationId, phase, String(body.title ?? '').trim().slice(0, 255),
          String(body.instructions ?? '').trim() || null, recurrence, recurrence === 'weekly' ? Number(body.weekday) : null,
          recurrence === 'once' ? parseDaybookDate(String(body.scheduled_date ?? '')) : null,
          Number(body.sort_order ?? 0), context.actorUserId, context.actorName],
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'create_communication') {
      const title = String(body.title ?? '').trim().slice(0, 255);
      const message = String(body.message ?? '').trim();
      const targetIds = Array.isArray(body.location_ids) ? body.location_ids.map(Number).filter(Number.isInteger) : [context.locationId];
      if (!title || !message || targetIds.length === 0) return error('Title, message, and target locations are required.');
      for (const targetId of targetIds) if (!(await validateLocation(context.businessId, targetId))) return error('A target location was not found.');
      const result = await imsExecute(
        `INSERT INTO pos_daybook_communications
           (business_id, title, message, priority, is_pinned, author_user_id, author_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, title, message, ['normal', 'important', 'urgent'].includes(String(body.priority)) ? body.priority : 'normal',
          body.is_pinned ? 1 : 0, context.actorUserId, context.actorName],
      );
      for (const targetId of targetIds) {
        await imsExecute(
          'INSERT INTO pos_daybook_communication_targets (business_id, communication_id, location_id) VALUES (?, ?, ?)',
          [context.businessId, result.insertId, targetId],
        );
      }
      return NextResponse.json({ success: true, id: result.insertId });
    }

    if (action === 'save_reference') {
      await imsExecute(
        `INSERT INTO pos_daybook_references (business_id, location_id, category, title, content, link_url, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, body.all_locations ? null : context.locationId, String(body.category ?? 'General').slice(0, 50),
          String(body.title ?? '').trim().slice(0, 255), String(body.content ?? '').trim(), String(body.link_url ?? '').trim() || null,
          Number(body.sort_order ?? 0)],
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save_guide') {
      await imsExecute(
        `INSERT INTO pos_daybook_product_guides
           (business_id, location_id, sku, product_name, category, shelf_location, box_location, guidance, image_url, image_alt, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, body.all_locations ? null : context.locationId, String(body.sku ?? '').trim() || null,
          String(body.product_name ?? '').trim().slice(0, 500), String(body.category ?? '').trim() || null,
          String(body.shelf_location ?? '').trim() || null, String(body.box_location ?? '').trim() || null,
          String(body.guidance ?? '').trim() || null, String(body.image_url ?? '').trim() || null,
          String(body.image_alt ?? '').trim() || null, String(body.status ?? 'active').slice(0, 50)],
      );
      return NextResponse.json({ success: true });
    }

    return error('Unknown Daybook action.');
  } catch (caught) {
    await reportRuntimeIssue({
      businessId: context.businessId,
      source: 'pos/daybook',
      operation: action || 'unknown_action',
      title: 'Store Daybook operation failed',
      error: caught,
      context: { locationId: context.locationId, action },
    });
    return error('The Daybook action could not be completed.', 500);
  }
}