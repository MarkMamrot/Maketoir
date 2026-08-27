import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  canEditDaybookItem,
  canManageDaybookTask,
  canTransitionDiscrepancy,
  canTransitionNeed,
  canTransitionRequest,
  getDaybookDateRange,
  normalizeDaybookColour,
  normalizeDaybookEditPolicy,
  normalizeStaffIdentity,
  parseDaybookDate,
  resolveDaybookLocationId,
} from '@/lib/pos/daybookService';
import type { DaybookDiscrepancyStatus, DaybookEditPolicy, DaybookNeedStatus, DaybookRequestStatus, DaybookStaffIdentity } from '@/lib/pos/daybookTypes';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';

const MANAGER_TIERS = new Set(['PosManager', 'StandardUser', 'Admin', 'SuperAdmin']);
const RECORD_TYPES = new Set(['customer_request', 'store_need', 'stock_discrepancy', 'incident']);
const SENSITIVE_REFERENCE_PATTERN = /\b(password|passcode|pin|secret|api[ _-]?key|access[ _-]?key|location code|register key)\b/i;

type DaybookContext = {
  businessId: string;
  locationId: number;
  locationName: string;
  actorUserId: number | null;
  actorName: string;
  actorTier: string;
  isManager: boolean;
};

async function resolveContext(locationOverride?: number): Promise<DaybookContext | null> {
  const session = await getImsSession(locationOverride ? ['marketoir_session'] : ['pos_session', 'marketoir_session']);
  if (!session?.businessId) return null;
  const raw = session as typeof session & { location_id?: number; location_name?: string; full_name?: string; username?: string };
  const sessionLocationId = Number(raw.location_id ?? 0);
  const requestedLocationId = Number(locationOverride ?? 0);
  const locationId = resolveDaybookLocationId(sessionLocationId, requestedLocationId);
  if (!locationId) return null;
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

type DaybookGuideProduct = {
  variant_id: string;
  product_id: string;
  product_name: string;
  option_label: string | null;
  sku: string | null;
  image_url: string | null;
  image_alt: string | null;
};

async function findGuideProducts(businessId: string, search: string, limit = 24): Promise<DaybookGuideProduct[]> {
  const like = `%${search.trim()}%`;
  return imsQuery<DaybookGuideProduct>(
    `SELECT v.variant_id, p.product_id, p.name AS product_name, v.sku,
            NULLIF(TRIM(BOTH ' / ' FROM CONCAT_WS(' / ', NULLIF(v.option1_value, ''), NULLIF(v.option2_value, ''), NULLIF(v.option3_value, ''))), '') AS option_label,
            image.url AS image_url, image.alt_text AS image_alt
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
     LEFT JOIN ims_product_images image ON image.id = (
       SELECT candidate.id FROM ims_product_images candidate
       WHERE candidate.product_id = p.product_id ORDER BY candidate.is_primary DESC, candidate.sort_order, candidate.id LIMIT 1
     )
     WHERE p.is_active = 1 AND v.is_active = 1
       AND (? = '' OR p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
     ORDER BY p.name, v.sku LIMIT ${limit}`,
    [businessId, search.trim(), like, like, like],
  );
}

async function resolveGuideProduct(businessId: string, variantId: string): Promise<DaybookGuideProduct | null> {
  if (!variantId) return null;
  const products = await imsQuery<DaybookGuideProduct>(
    `SELECT v.variant_id, p.product_id, p.name AS product_name, v.sku,
            NULLIF(TRIM(BOTH ' / ' FROM CONCAT_WS(' / ', NULLIF(v.option1_value, ''), NULLIF(v.option2_value, ''), NULLIF(v.option3_value, ''))), '') AS option_label,
            image.url AS image_url, image.alt_text AS image_alt
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
     LEFT JOIN ims_product_images image ON image.id = (
       SELECT candidate.id FROM ims_product_images candidate
       WHERE candidate.product_id = p.product_id ORDER BY candidate.is_primary DESC, candidate.sort_order, candidate.id LIMIT 1
     )
     WHERE v.variant_id = ? AND p.is_active = 1 AND v.is_active = 1 LIMIT 1`,
    [businessId, variantId],
  );
  return products[0] ?? null;
}

async function getEditPolicy(businessId: string): Promise<DaybookEditPolicy> {
  const rows = await imsQuery<{ value: string }>(
    "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'pos_daybook_edit_policy' LIMIT 1",
    [businessId],
  );
  return normalizeDaybookEditPolicy(rows[0]?.value);
}

function mayEdit(context: DaybookContext, staff: DaybookStaffIdentity, policy: DaybookEditPolicy, item: {
  author_user_id?: number | null;
  author_staff_identity_id?: number | null;
  author_staff_initials?: string | null;
}) {
  return canEditDaybookItem({
    policy,
    isManager: context.isManager,
    actorUserId: context.actorUserId,
    staffIdentityId: staff.id ?? null,
    staffInitials: staff.initials,
    authorUserId: Number(item.author_user_id ?? 0) || null,
    authorStaffIdentityId: Number(item.author_staff_identity_id ?? 0) || null,
    authorStaffInitials: String(item.author_staff_initials ?? ''),
  });
}

function mayManageTask(context: DaybookContext, staff: DaybookStaffIdentity, policy: DaybookEditPolicy, item: {
  author_user_id?: number | null;
  author_staff_identity_id?: number | null;
  author_staff_initials?: string | null;
}) {
  return canManageDaybookTask({
    policy,
    isManager: context.isManager,
    actorUserId: context.actorUserId,
    staffIdentityId: staff.id ?? null,
    staffInitials: staff.initials,
    authorUserId: Number(item.author_user_id ?? 0) || null,
    authorStaffIdentityId: Number(item.author_staff_identity_id ?? 0) || null,
    authorStaffInitials: String(item.author_staff_initials ?? ''),
  });
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
  const url = new URL(request.url);
  const context = await resolveContext(Number(url.searchParams.get('location_id') ?? 0));
  if (!context) return error('An active POS location is required.', 401);
  if (url.searchParams.get('view') === 'products') {
    const search = String(url.searchParams.get('q') ?? '').trim().slice(0, 120);
    try {
      return NextResponse.json({ products: await findGuideProducts(context.businessId, search) });
    } catch (caught) {
      await reportRuntimeIssue({
        businessId: context.businessId,
        source: 'pos/daybook',
        operation: 'search_guide_products',
        title: 'Store Daybook product search failed',
        error: caught,
        context: { locationId: context.locationId },
      });
      return error('Products could not be loaded.', 500);
    }
  }
  const taskDate = parseDaybookDate(url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10));
  const staffInitials = String(url.searchParams.get('initials') ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
  if (!taskDate) return error('A valid date is required.');

  try {
    const taskDates = getDaybookDateRange(taskDate, 7);
    for (const date of taskDates) await materializeTasks(context, date);
    const [rawTasks, rawTaskHistory, rawCommunications, rawRecords, rawReferences, rawGuides, staff, locations, communicationReads, editPolicy] = await Promise.all([
      imsQuery(
        `SELECT i.*, s.staff_name AS last_staff_name, s.staff_initials AS last_staff_initials,
                s.actor_name AS last_actor_name, s.created_at AS signed_at,
                t.recurrence, t.weekday, t.scheduled_date, t.instructions,
                t.created_by_id, t.created_by_staff_identity_id, t.created_by_staff_initials
         FROM pos_daybook_task_instances i
         JOIN pos_daybook_task_templates t ON t.business_id = i.business_id AND t.id = i.template_id
         LEFT JOIN pos_daybook_task_signoffs s ON s.id = (
           SELECT s2.id FROM pos_daybook_task_signoffs s2
           WHERE s2.business_id = i.business_id AND s2.instance_id = i.id ORDER BY s2.id DESC LIMIT 1
         )
         WHERE i.business_id = ? AND i.location_id = ? AND i.task_date = ?
           AND (t.is_active = 1 OR i.status = 'completed' OR i.task_date < CURRENT_DATE())
         ORDER BY FIELD(i.phase, 'opening','during_day','closing'), i.id`,
        [context.businessId, context.locationId, taskDate],
      ),
      imsQuery(
        `SELECT i.id, i.template_id, i.task_date, i.title_snapshot, i.phase, i.status, t.is_active,
          t.recurrence, t.weekday, t.scheduled_date, t.instructions,
          t.created_by_id, t.created_by_staff_identity_id, t.created_by_staff_initials,
                s.staff_name, s.staff_initials, s.created_at AS signed_at
         FROM pos_daybook_task_instances i
         JOIN pos_daybook_task_templates t ON t.business_id = i.business_id AND t.id = i.template_id
         LEFT JOIN pos_daybook_task_signoffs s ON s.id = (
           SELECT s2.id FROM pos_daybook_task_signoffs s2
           WHERE s2.business_id = i.business_id AND s2.instance_id = i.id ORDER BY s2.id DESC LIMIT 1
         )
         WHERE i.business_id = ? AND i.location_id = ? AND i.task_date BETWEEN ? AND ?
           AND (t.is_active = 1 OR i.status = 'completed' OR i.task_date < CURRENT_DATE())
         ORDER BY FIELD(i.phase, 'opening','during_day','closing'), i.template_id, i.task_date`,
        [context.businessId, context.locationId, taskDates[0], taskDate],
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
           AND status <> 'deleted'
           AND (record_type <> 'incident' OR ? = 1)
         ORDER BY created_at DESC LIMIT 500`,
        [context.businessId, context.locationId, context.locationId, context.locationId, context.isManager ? 1 : 0],
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
      imsQuery<{ communication_id: number; staff_name: string; staff_initials: string; read_at: string }>(
        `SELECT DISTINCT r.communication_id, r.staff_name, r.staff_initials, r.read_at
         FROM pos_daybook_communication_reads r
         JOIN pos_daybook_communication_targets t ON t.business_id = r.business_id AND t.communication_id = r.communication_id
         WHERE r.business_id = ? AND t.location_id = ? ORDER BY r.read_at`,
        [context.businessId, context.locationId],
      ),
      getEditPolicy(context.businessId),
    ]);
    const selectedStaff: DaybookStaffIdentity = { id: null, name: '', initials: staffInitials };
    const readersByCommunication = new Map<number, { name: string; initials: string; read_at: string }[]>();
    for (const read of communicationReads) {
      const readers = readersByCommunication.get(Number(read.communication_id)) ?? [];
      if (!readers.some(reader => reader.initials === read.staff_initials)) {
        readers.push({ name: read.staff_name, initials: read.staff_initials, read_at: read.read_at });
      }
      readersByCommunication.set(Number(read.communication_id), readers);
    }
    const communications = rawCommunications.map(item => ({
      ...item,
      readers: readersByCommunication.get(Number(item.id)) ?? [],
      can_edit: mayEdit(context, selectedStaff, editPolicy, item),
    }));
    const tasks = rawTasks.map(item => ({
      ...item,
      can_edit: Boolean(item.is_active) && mayManageTask(context, selectedStaff, editPolicy, {
        author_user_id: item.created_by_id,
        author_staff_identity_id: item.created_by_staff_identity_id,
        author_staff_initials: item.created_by_staff_initials,
      }),
    }));
    const taskHistory = rawTaskHistory.map(item => ({
      ...item,
      can_edit: Boolean(item.is_active) && mayManageTask(context, selectedStaff, editPolicy, {
        author_user_id: item.created_by_id,
        author_staff_identity_id: item.created_by_staff_identity_id,
        author_staff_initials: item.created_by_staff_initials,
      }),
    }));
    const records = rawRecords.map(item => ({
      ...item,
      can_edit: (item.record_type !== 'incident' || context.isManager) && mayEdit(context, selectedStaff, editPolicy, {
        author_user_id: item.actor_user_id,
        author_staff_identity_id: item.staff_identity_id,
        author_staff_initials: item.staff_initials,
      }),
    }));
    const references = rawReferences.map(item => ({ ...item, can_edit: mayEdit(context, selectedStaff, editPolicy, item) }));
    const guides = rawGuides.map(item => ({ ...item, can_edit: mayEdit(context, selectedStaff, editPolicy, item) }));
    return NextResponse.json({
      date: taskDate,
      location: { id: context.locationId, name: context.locationName },
      permissions: { manager: context.isManager, editPolicy },
      tasks,
      taskDates,
      taskHistory,
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
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return error('Invalid JSON.'); }
  const context = await resolveContext(Number(body.location_id ?? 0));
  if (!context) return error('An active POS location is required.', 401);
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

    if (action === 'delete_item') {
      const itemType = String(body.item_type ?? '');
      const itemId = Number(body.item_id ?? 0);
      if (!['task', 'communication', 'record', 'reference', 'guide'].includes(itemType) || !Number.isInteger(itemId) || itemId <= 0) {
        return error('Invalid Daybook item.');
      }
      const editPolicy = await getEditPolicy(context.businessId);
      const connection = await getIMSPool().getConnection();
      try {
        await connection.beginTransaction();
        let item: {
          author_user_id?: number | null;
          author_staff_identity_id?: number | null;
          author_staff_initials?: string | null;
          record_type?: string;
          status?: string;
        } | undefined;

        if (itemType === 'task') {
          const [rows] = await connection.execute(
            `SELECT created_by_id AS author_user_id, created_by_staff_identity_id AS author_staff_identity_id,
                    created_by_staff_initials AS author_staff_initials
             FROM pos_daybook_task_templates
             WHERE id = ? AND business_id = ? AND location_id = ? AND is_active = 1 FOR UPDATE`,
            [itemId, context.businessId, context.locationId],
          ) as any;
          item = rows[0];
        } else if (itemType === 'communication') {
          const [rows] = await connection.execute(
            `SELECT c.author_user_id, c.author_staff_identity_id, c.author_staff_initials
             FROM pos_daybook_communications c
             JOIN pos_daybook_communication_targets t ON t.business_id = c.business_id AND t.communication_id = c.id
             WHERE c.id = ? AND c.business_id = ? AND t.location_id = ? AND c.archived_at IS NULL LIMIT 1 FOR UPDATE`,
            [itemId, context.businessId, context.locationId],
          ) as any;
          item = rows[0];
        } else if (itemType === 'record') {
          const [rows] = await connection.execute(
            `SELECT record_type, status, actor_user_id AS author_user_id, staff_identity_id AS author_staff_identity_id,
                    staff_initials AS author_staff_initials
             FROM pos_daybook_records
             WHERE id = ? AND business_id = ? AND status <> 'deleted'
               AND (location_id = ? OR source_location_id = ? OR destination_location_id = ?) LIMIT 1 FOR UPDATE`,
            [itemId, context.businessId, context.locationId, context.locationId, context.locationId],
          ) as any;
          item = rows[0];
          if (item?.record_type === 'incident' && !context.isManager) item = undefined;
        } else if (itemType === 'reference') {
          const [rows] = await connection.execute(
            `SELECT author_user_id, author_staff_identity_id, author_staff_initials
             FROM pos_daybook_references
             WHERE id = ? AND business_id = ? AND is_active = 1 AND (location_id IS NULL OR location_id = ?) FOR UPDATE`,
            [itemId, context.businessId, context.locationId],
          ) as any;
          item = rows[0];
        } else {
          const [rows] = await connection.execute(
            `SELECT author_user_id, author_staff_identity_id, author_staff_initials
             FROM pos_daybook_product_guides
             WHERE id = ? AND business_id = ? AND status <> 'archived' AND (location_id IS NULL OR location_id = ?) FOR UPDATE`,
            [itemId, context.businessId, context.locationId],
          ) as any;
          item = rows[0];
        }

        if (!item) {
          await connection.rollback();
          return error('Daybook item not found.', 404);
        }
        if (!(itemType === 'task' ? mayManageTask(context, staff, editPolicy, item) : mayEdit(context, staff, editPolicy, item))) {
          await connection.rollback();
          return error('You do not have permission to delete this item.', 403);
        }

        if (itemType === 'task') {
          await connection.execute(
            'UPDATE pos_daybook_task_templates SET is_active = 0 WHERE id = ? AND business_id = ? AND location_id = ?',
            [itemId, context.businessId, context.locationId],
          );
        } else if (itemType === 'communication') {
          await connection.execute(
            'UPDATE pos_daybook_communications SET archived_at = NOW() WHERE id = ? AND business_id = ?',
            [itemId, context.businessId],
          );
        } else if (itemType === 'record') {
          await connection.execute(
            "UPDATE pos_daybook_records SET status = 'deleted', resolved_at = NOW() WHERE id = ? AND business_id = ?",
            [itemId, context.businessId],
          );
          await connection.execute(
            `INSERT INTO pos_daybook_record_events
               (business_id, record_id, from_status, to_status, note, staff_identity_id, staff_name,
                staff_initials, actor_user_id, actor_name, actor_tier)
             VALUES (?, ?, ?, 'deleted', 'Deleted from Daybook', ?, ?, ?, ?, ?, ?)`,
            [context.businessId, itemId, item.status, staff.id, staff.name, staff.initials,
              context.actorUserId, context.actorName, context.actorTier],
          );
        } else if (itemType === 'reference') {
          await connection.execute(
            'UPDATE pos_daybook_references SET is_active = 0 WHERE id = ? AND business_id = ?',
            [itemId, context.businessId],
          );
        } else {
          await connection.execute(
            "UPDATE pos_daybook_product_guides SET status = 'archived' WHERE id = ? AND business_id = ?",
            [itemId, context.businessId],
          );
        }
        await connection.execute(
          `INSERT INTO pos_daybook_content_events
             (business_id, location_id, item_type, item_id, action, staff_identity_id, staff_name,
              staff_initials, actor_user_id, actor_name, actor_tier)
           VALUES (?, ?, ?, ?, 'deleted', ?, ?, ?, ?, ?, ?)`,
          [context.businessId, context.locationId, itemType, itemId, staff.id, staff.name, staff.initials,
            context.actorUserId, context.actorName, context.actorTier],
        );
        await connection.commit();
        return NextResponse.json({ success: true });
      } catch (caught) {
        await connection.rollback().catch(() => {});
        throw caught;
      } finally {
        connection.release();
      }
    }

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
            actor_user_id, actor_name, background_color)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, context.locationId, recordType, recordType === 'store_need' ? 'requested' : 'open',
          parseDaybookDate(String(body.occurred_on ?? '')), title, JSON.stringify(details), context.locationId,
           destinationLocationId, staff.id, staff.name, staff.initials, context.actorUserId, context.actorName,
           normalizeDaybookColour(body.background_color)],
      );
      return NextResponse.json({ success: true, id: result.insertId });
    }

    if (action === 'update_record') {
      const recordId = Number(body.record_id ?? 0);
      const rows = await imsQuery<{
        id: number; record_type: string; actor_user_id: number | null; staff_identity_id: number | null; staff_initials: string;
      }>(
        `SELECT id, record_type, actor_user_id, staff_identity_id, staff_initials FROM pos_daybook_records
         WHERE id = ? AND business_id = ? AND (location_id = ? OR source_location_id = ? OR destination_location_id = ?) LIMIT 1`,
        [recordId, context.businessId, context.locationId, context.locationId, context.locationId],
      );
      const record = rows[0];
      if (!record || (record.record_type === 'incident' && !context.isManager)) return error('Record not found.', 404);
      if (!mayManageTask(context, staff, await getEditPolicy(context.businessId), {
        author_user_id: record.actor_user_id,
        author_staff_identity_id: record.staff_identity_id,
        author_staff_initials: record.staff_initials,
      })) return error('You do not have permission to edit this item.', 403);
      const title = String(body.title ?? '').trim().slice(0, 255);
      if (!title) return error('A title is required.');
      const details = jsonDetails(body.details);
      if (record.record_type === 'stock_discrepancy') {
        const system = Number(details.system_quantity);
        const physical = Number(details.physical_quantity);
        if (Number.isFinite(system) && Number.isFinite(physical)) details.variance = physical - system;
      }
      await imsExecute(
        `UPDATE pos_daybook_records SET title = ?, occurred_on = ?, details_json = ?, background_color = ?
         WHERE id = ? AND business_id = ?`,
        [title, parseDaybookDate(String(body.occurred_on ?? '')), JSON.stringify(details),
          normalizeDaybookColour(body.background_color), recordId, context.businessId],
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'update_communication') {
      const communicationId = Number(body.communication_id ?? 0);
      const rows = await imsQuery<{
        id: number; author_user_id: number | null; author_staff_identity_id: number | null; author_staff_initials: string | null;
      }>(
        `SELECT c.id, c.author_user_id, c.author_staff_identity_id, c.author_staff_initials
         FROM pos_daybook_communications c
         JOIN pos_daybook_communication_targets t ON t.business_id = c.business_id AND t.communication_id = c.id
         WHERE c.id = ? AND c.business_id = ? AND t.location_id = ? LIMIT 1`,
        [communicationId, context.businessId, context.locationId],
      );
      const communication = rows[0];
      if (!communication) return error('Communication not found.', 404);
      if (!mayEdit(context, staff, await getEditPolicy(context.businessId), communication)) return error('You do not have permission to edit this item.', 403);
      const title = String(body.title ?? '').trim().slice(0, 255);
      const message = String(body.message ?? '').trim();
      if (!title || !message) return error('Title and message are required.');
      await imsExecute(
        `UPDATE pos_daybook_communications SET title = ?, message = ?, priority = ?, background_color = ?
         WHERE id = ? AND business_id = ?`,
        [title, message, ['normal', 'important', 'urgent'].includes(String(body.priority)) ? body.priority : 'normal',
          normalizeDaybookColour(body.background_color), communicationId, context.businessId],
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'update_guide') {
      const guideId = Number(body.guide_id ?? 0);
      const rows = await imsQuery<{
        id: number; author_user_id: number | null; author_staff_identity_id: number | null; author_staff_initials: string | null;
      }>(
        `SELECT id, author_user_id, author_staff_identity_id, author_staff_initials FROM pos_daybook_product_guides
         WHERE id = ? AND business_id = ? AND (location_id IS NULL OR location_id = ?) LIMIT 1`,
        [guideId, context.businessId, context.locationId],
      );
      const guide = rows[0];
      if (!guide) return error('Product guide not found.', 404);
      if (!mayEdit(context, staff, await getEditPolicy(context.businessId), guide)) return error('You do not have permission to edit this item.', 403);
      const product = await resolveGuideProduct(context.businessId, String(body.variant_id ?? ''));
      if (!product) return error('Choose an active product from the product list.');
      const productName = `${product.product_name}${product.option_label ? ` - ${product.option_label}` : ''}`.slice(0, 500);
      await imsExecute(
        `UPDATE pos_daybook_product_guides SET variant_id = ?, sku = ?, product_name = ?, category = ?, shelf_location = ?,
           box_location = ?, guidance = ?, image_url = ?, image_alt = ?, background_color = ?
         WHERE id = ? AND business_id = ?`,
        [product.variant_id, product.sku, productName, String(body.category ?? '').trim() || null,
          String(body.shelf_location ?? '').trim() || null, String(body.box_location ?? '').trim() || null,
          String(body.guidance ?? '').trim() || null, product.image_url,
          product.image_alt || productName, normalizeDaybookColour(body.background_color), guideId, context.businessId],
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'update_reference') {
      const referenceId = Number(body.reference_id ?? 0);
      const rows = await imsQuery<{
        id: number; author_user_id: number | null; author_staff_identity_id: number | null; author_staff_initials: string | null;
      }>(
        `SELECT id, author_user_id, author_staff_identity_id, author_staff_initials FROM pos_daybook_references
         WHERE id = ? AND business_id = ? AND is_active = 1 AND (location_id IS NULL OR location_id = ?) LIMIT 1`,
        [referenceId, context.businessId, context.locationId],
      );
      const reference = rows[0];
      if (!reference) return error('Reference not found.', 404);
      if (!mayEdit(context, staff, await getEditPolicy(context.businessId), reference)) return error('You do not have permission to edit this item.', 403);
      const title = String(body.title ?? '').trim().slice(0, 255);
      const content = String(body.content ?? '').trim();
      if (!title || !content) return error('Title and information are required.');
      if (SENSITIVE_REFERENCE_PATTERN.test(`${title} ${content}`)) return error('Passwords, PINs, keys, secrets, and location codes cannot be stored in Daybook.', 422);
      await imsExecute(
        `UPDATE pos_daybook_references SET category = ?, title = ?, content = ?, link_url = ?, background_color = ?
         WHERE id = ? AND business_id = ?`,
        [String(body.category ?? 'General').slice(0, 50), title, content, String(body.link_url ?? '').trim() || null,
          normalizeDaybookColour(body.background_color), referenceId, context.businessId],
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'update_task') {
      const templateId = Number(body.template_id ?? 0);
      const rows = await imsQuery<{
        id: number; created_by_id: number | null; created_by_staff_identity_id: number | null; created_by_staff_initials: string | null;
      }>(
        `SELECT id, created_by_id, created_by_staff_identity_id, created_by_staff_initials
         FROM pos_daybook_task_templates WHERE id = ? AND business_id = ? AND location_id = ? LIMIT 1`,
        [templateId, context.businessId, context.locationId],
      );
      const template = rows[0];
      if (!template) return error('Task not found.', 404);
      if (!mayEdit(context, staff, await getEditPolicy(context.businessId), {
        author_user_id: template.created_by_id,
        author_staff_identity_id: template.created_by_staff_identity_id,
        author_staff_initials: template.created_by_staff_initials,
      })) return error('You do not have permission to edit this item.', 403);
      const recurrence = ['daily', 'weekly', 'once'].includes(String(body.recurrence)) ? String(body.recurrence) : 'daily';
      const phase = ['opening', 'during_day', 'closing'].includes(String(body.phase)) ? String(body.phase) : 'during_day';
      const title = String(body.title ?? '').trim().slice(0, 255);
      if (!title) return error('A task title is required.');
      const instructions = String(body.instructions ?? '').trim() || null;
      await imsExecute(
        `UPDATE pos_daybook_task_templates SET phase = ?, title = ?, instructions = ?, recurrence = ?, weekday = ?, scheduled_date = ?
         WHERE id = ? AND business_id = ? AND location_id = ?`,
        [phase, title, instructions, recurrence, recurrence === 'weekly' ? Number(body.weekday) : null,
          recurrence === 'once' ? parseDaybookDate(String(body.scheduled_date ?? '')) : null,
          templateId, context.businessId, context.locationId],
      );
      await imsExecute(
        `UPDATE pos_daybook_task_instances SET phase = ?, title_snapshot = ?, instructions_snapshot = ?
         WHERE business_id = ? AND location_id = ? AND template_id = ? AND status = 'open'`,
        [phase, title, instructions, context.businessId, context.locationId, templateId],
      );
      return NextResponse.json({ success: true });
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
      if (record.record_type === 'store_need') {
        const warehouseStages = ['approved', 'packed', 'sent'];
        if (warehouseStages.includes(toStatus) && context.locationId !== Number(record.destination_location_id)) return error('The destination warehouse must complete that stage.', 403);
        if (toStatus === 'received' && context.locationId !== Number(record.source_location_id)) return error('The requesting store must confirm receipt.', 403);
      }
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

    if (action === 'save_settings') {
      const editPolicy = normalizeDaybookEditPolicy(body.edit_policy);
      await imsExecute(
        `INSERT INTO ims_settings (business_id, \`key\`, value) VALUES (?, 'pos_daybook_edit_policy', ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [context.businessId, editPolicy],
      );
      return NextResponse.json({ success: true, editPolicy });
    }

    if (action === 'create_task') {
      const recurrence = ['daily', 'weekly', 'once'].includes(String(body.recurrence)) ? String(body.recurrence) : 'daily';
      const phase = ['opening', 'during_day', 'closing'].includes(String(body.phase)) ? String(body.phase) : 'during_day';
      const title = String(body.title ?? '').trim().slice(0, 255);
      if (!title) return error('A task title is required.');
      await imsExecute(
        `INSERT INTO pos_daybook_task_templates
           (business_id, location_id, phase, title, instructions, recurrence, weekday, scheduled_date,
            sort_order, created_by_id, created_by_name, created_by_staff_identity_id, created_by_staff_name, created_by_staff_initials)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, context.locationId, phase, title,
          String(body.instructions ?? '').trim() || null, recurrence, recurrence === 'weekly' ? Number(body.weekday) : null,
          recurrence === 'once' ? parseDaybookDate(String(body.scheduled_date ?? '')) : null,
          Number(body.sort_order ?? 0), context.actorUserId, context.actorName, staff.id, staff.name, staff.initials],
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
           (business_id, title, message, priority, is_pinned, author_user_id, author_name,
            author_staff_identity_id, author_staff_name, author_staff_initials, background_color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, title, message, ['normal', 'important', 'urgent'].includes(String(body.priority)) ? body.priority : 'normal',
          body.is_pinned ? 1 : 0, context.actorUserId, context.actorName, staff.id, staff.name, staff.initials,
          normalizeDaybookColour(body.background_color)],
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
      const referenceText = `${String(body.title ?? '')} ${String(body.content ?? '')}`;
      if (SENSITIVE_REFERENCE_PATTERN.test(referenceText)) return error('Passwords, PINs, keys, secrets, and location codes cannot be stored in Daybook.', 422);
      await imsExecute(
        `INSERT INTO pos_daybook_references
           (business_id, location_id, category, title, content, link_url, sort_order, background_color,
            author_user_id, author_name, author_staff_identity_id, author_staff_name, author_staff_initials)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, body.all_locations ? null : context.locationId, String(body.category ?? 'General').slice(0, 50),
          String(body.title ?? '').trim().slice(0, 255), String(body.content ?? '').trim(), String(body.link_url ?? '').trim() || null,
          Number(body.sort_order ?? 0), normalizeDaybookColour(body.background_color), context.actorUserId, context.actorName,
          staff.id, staff.name, staff.initials],
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save_guide') {
      const product = await resolveGuideProduct(context.businessId, String(body.variant_id ?? ''));
      if (!product) return error('Choose an active product from the product list.');
      const productName = `${product.product_name}${product.option_label ? ` - ${product.option_label}` : ''}`.slice(0, 500);
      await imsExecute(
        `INSERT INTO pos_daybook_product_guides
            (business_id, location_id, variant_id, sku, product_name, category, shelf_location, box_location, guidance,
            image_url, image_alt, status, background_color, author_user_id, author_name,
            author_staff_identity_id, author_staff_name, author_staff_initials)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.businessId, body.all_locations ? null : context.locationId, product.variant_id, product.sku,
          productName, String(body.category ?? '').trim() || null,
          String(body.shelf_location ?? '').trim() || null, String(body.box_location ?? '').trim() || null,
          String(body.guidance ?? '').trim() || null, product.image_url,
          product.image_alt || productName, String(body.status ?? 'active').slice(0, 50),
          normalizeDaybookColour(body.background_color), context.actorUserId, context.actorName,
          staff.id, staff.name, staff.initials],
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