import { ImsContactsRepo } from '@/lib/ims/ImsRepository';
import {
  buildContactCrmTimeline,
  type ContactCrmActivityCategory,
  type ContactCrmTimelineEntry,
} from '@/lib/ims/contactCrmTimeline';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export const CRM_INTERACTION_TYPES = ['note', 'call', 'meeting', 'other'] as const;
export const CRM_TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export const CRM_TASK_STATUSES = ['open', 'completed', 'cancelled'] as const;

export class ContactCrmValidationError extends Error {}
export class ContactCrmNotFoundError extends Error {}

export interface ContactCrmActor {
  id: number | null;
  name: string;
}

export interface ContactCrmTaskInput {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: string;
  assignedUserId?: number | null;
  assignedUserName?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanRequired(value: unknown, field: string, max: number): string {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) throw new ContactCrmValidationError(`${field} is required.`);
  if (cleaned.length > max) throw new ContactCrmValidationError(`${field} must be ${max} characters or fewer.`);
  return cleaned;
}

function cleanOptional(value: unknown, max: number): string | null {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return null;
  if (cleaned.length > max) throw new ContactCrmValidationError(`Value must be ${max} characters or fewer.`);
  return cleaned;
}

function cleanDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value);
  if (!DATE_RE.test(cleaned)) throw new ContactCrmValidationError('Due date must use YYYY-MM-DD format.');
  return cleaned;
}

function normalizeTagName(value: unknown): { name: string; normalizedName: string } {
  const name = cleanRequired(value, 'Tag name', 100).replace(/\s+/g, ' ');
  return { name, normalizedName: name.toLocaleLowerCase('en-AU') };
}

async function requireContact(businessId: string, contactId: number) {
  if (!Number.isInteger(contactId) || contactId <= 0) throw new ContactCrmNotFoundError('Contact not found.');
  const contact = await ImsContactsRepo.get(contactId, businessId);
  if (!contact) throw new ContactCrmNotFoundError('Contact not found.');
  return contact;
}

export async function getContactCrmProfile(businessId: string, contactId: number) {
  const contact = await requireContact(businessId, contactId);
  const [posSummary, orderSummary, creditSummary, loyalty, tags, taskSummary] = await Promise.all([
    imsQuery<any>(
      `SELECT COUNT(*) AS transaction_count,
              COALESCE(SUM(CASE WHEN ps.sale_type = 'return' THEN -ABS(ps.total) ELSE ps.total END), 0) AS net_total,
              MAX(COALESCE(ps.completed_at, ps.created_at)) AS last_activity_at
         FROM pos_sales ps
         JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
        WHERE ps.customer_id = ? AND ps.status NOT IN ('open','parked','voided')`,
      [businessId, contactId],
    ),
    imsQuery<any>(
      `SELECT COUNT(*) AS order_count,
              COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 0 ELSE total_amount END), 0) AS order_total,
              MAX(COALESCE(fulfilled_date, created_at)) AS last_activity_at
         FROM ims_sales_orders WHERE business_id = ? AND customer_id = ?`,
      [businessId, contactId],
    ),
    imsQuery<any>(
      `SELECT COUNT(*) AS credit_count,
              COALESCE(SUM(CASE WHEN status IN ('complete','reversed') THEN total_amount ELSE 0 END), 0) AS credit_total,
              MAX(COALESCE(completed_at, created_at)) AS last_activity_at
         FROM ims_credit_notes WHERE business_id = ? AND customer_id = ?`,
      [businessId, contactId],
    ),
    imsQuery<any>(
      `SELECT balance_points, lifetime_earned, lifetime_redeemed, status
         FROM loyalty_accounts WHERE business_id = ? AND contact_id = ? LIMIT 1`,
      [businessId, contactId],
    ),
    listContactCrmTags(businessId, contactId, false),
    imsQuery<any>(
      `SELECT SUM(status = 'open') AS open_count,
              SUM(status = 'open' AND due_date < CURRENT_DATE) AS overdue_count
         FROM ims_crm_tasks WHERE business_id = ? AND contact_id = ?`,
      [businessId, contactId],
    ),
  ]);

  return {
    contact,
    summaries: {
      pos: posSummary[0] ?? { transaction_count: 0, net_total: 0, last_activity_at: null },
      salesOrders: orderSummary[0] ?? { order_count: 0, order_total: 0, last_activity_at: null },
      creditNotes: creditSummary[0] ?? { credit_count: 0, credit_total: 0, last_activity_at: null },
      loyalty: loyalty[0] ?? null,
      storeCredit: Number(contact.store_credit ?? 0),
      tasks: taskSummary[0] ?? { open_count: 0, overdue_count: 0 },
    },
    tags,
  };
}

export async function getContactCrmTimeline(
  businessId: string,
  contactId: number,
  options: { categories?: ContactCrmActivityCategory[]; from?: string; to?: string; limit?: number } = {},
): Promise<{ entries: ContactCrmTimelineEntry[]; truncated: boolean }> {
  await requireContact(businessId, contactId);
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 100), 200));
  const sourceLimit = 200;
  const from = DATE_RE.test(options.from ?? '') ? options.from as string : null;
  const to = DATE_RE.test(options.to ?? '') ? options.to as string : null;
  const dateSql = (expression: string) => `${from ? ` AND DATE(${expression}) >= ?` : ''}${to ? ` AND DATE(${expression}) <= ?` : ''}`;
  const dateParams = () => [from, to].filter((value): value is string => Boolean(value));
  const [posSales, salesOrders, creditNotes, storeCreditTransactions, loyaltyTransactions, interactions, tasks] = await Promise.all([
    imsQuery<any>(
      `SELECT ps.id, ps.sale_type, ps.status, ps.total, ps.cashier_name, ps.created_at, ps.completed_at, l.name AS location_name
         FROM pos_sales ps
         JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
        WHERE ps.customer_id = ?${dateSql('COALESCE(ps.completed_at, ps.created_at)')}
        ORDER BY COALESCE(ps.completed_at, ps.created_at) DESC LIMIT ${sourceLimit}`,
      [businessId, contactId, ...dateParams()],
    ),
    imsQuery<any>(
      `SELECT id, so_number, so_type, status, total_amount, order_date, fulfilled_date, created_at
        FROM ims_sales_orders WHERE business_id = ? AND customer_id = ?${dateSql('COALESCE(fulfilled_date, created_at)')}
        ORDER BY COALESCE(fulfilled_date, created_at) DESC LIMIT ${sourceLimit}`,
      [businessId, contactId, ...dateParams()],
    ),
    imsQuery<any>(
      `SELECT id, cn_number, source, status, total_amount, cn_date, completed_at, created_at, created_by
        FROM ims_credit_notes WHERE business_id = ? AND customer_id = ?${dateSql('COALESCE(completed_at, created_at)')}
        ORDER BY COALESCE(completed_at, created_at) DESC LIMIT ${sourceLimit}`,
      [businessId, contactId, ...dateParams()],
    ),
    imsQuery<any>(
      `SELECT id, type, amount, balance_after, created_at
        FROM store_credit_transactions WHERE contact_id = ?${dateSql('created_at')}
        ORDER BY created_at DESC LIMIT ${sourceLimit}`,
      [contactId, ...dateParams()],
    ),
    imsQuery<any>(
      `SELECT lt.id, lt.type, lt.points_delta, lt.balance_after, lt.channel, lt.actor_id, lt.created_at
         FROM loyalty_transactions lt
         JOIN loyalty_accounts la ON la.id = lt.account_id AND la.business_id = ? AND la.contact_id = ?
        WHERE lt.business_id = ?${dateSql('lt.created_at')} ORDER BY lt.created_at DESC LIMIT ${sourceLimit}`,
      [businessId, contactId, businessId, ...dateParams()],
    ),
    imsQuery<any>(
      `SELECT id, interaction_type, body, occurred_at, actor_name, created_at
        FROM ims_crm_interactions WHERE business_id = ? AND contact_id = ?${dateSql('COALESCE(occurred_at, created_at)')}
        ORDER BY COALESCE(occurred_at, created_at) DESC LIMIT ${sourceLimit}`,
      [businessId, contactId, ...dateParams()],
    ),
    imsQuery<any>(
      `SELECT id, title, due_date, status, assigned_user_name, created_by_name,
              completed_by_name, created_at, completed_at
        FROM ims_crm_tasks WHERE business_id = ? AND contact_id = ?${dateSql('COALESCE(completed_at, created_at)')}
        ORDER BY COALESCE(completed_at, created_at) DESC LIMIT ${sourceLimit}`,
      [businessId, contactId, ...dateParams()],
    ),
  ]);
  const entries = buildContactCrmTimeline(
    { posSales, salesOrders, creditNotes, storeCreditTransactions, loyaltyTransactions, interactions, tasks },
    { ...options, limit },
  );
  const anySourceAtLimit = [posSales, salesOrders, creditNotes, storeCreditTransactions,
    loyaltyTransactions, interactions, tasks].some(rows => rows.length === sourceLimit);
  return { entries, truncated: entries.length === limit || anySourceAtLimit };
}

export async function listContactCrmInteractions(businessId: string, contactId: number) {
  await requireContact(businessId, contactId);
  return imsQuery<any>(
    `SELECT id, interaction_type, body, occurred_at, actor_id, actor_name, created_at
       FROM ims_crm_interactions WHERE business_id = ? AND contact_id = ?
      ORDER BY COALESCE(occurred_at, created_at) DESC, id DESC LIMIT 200`,
    [businessId, contactId],
  );
}

export async function createContactCrmInteraction(
  businessId: string,
  contactId: number,
  input: { interactionType?: string; body: unknown; occurredAt?: unknown },
  actor: ContactCrmActor,
) {
  await requireContact(businessId, contactId);
  const interactionType = String(input.interactionType ?? 'note');
  if (!CRM_INTERACTION_TYPES.includes(interactionType as typeof CRM_INTERACTION_TYPES[number])) {
    throw new ContactCrmValidationError('Invalid interaction type.');
  }
  const body = cleanRequired(input.body, 'Interaction', 10_000);
  const occurred = input.occurredAt ? new Date(String(input.occurredAt)) : null;
  if (occurred && Number.isNaN(occurred.getTime())) throw new ContactCrmValidationError('Invalid interaction date.');
  const result = await imsExecute(
    `INSERT INTO ims_crm_interactions
       (business_id, contact_id, interaction_type, body, occurred_at, actor_id, actor_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [businessId, contactId, interactionType, body, occurred?.toISOString().slice(0, 19).replace('T', ' ') ?? null, actor.id, actor.name],
  );
  return Number(result.insertId);
}

export async function listContactCrmTasks(businessId: string, contactId: number) {
  await requireContact(businessId, contactId);
  return imsQuery<any>(
    `SELECT * FROM ims_crm_tasks WHERE business_id = ? AND contact_id = ?
      ORDER BY status = 'open' DESC, due_date IS NULL, due_date, id DESC LIMIT 200`,
    [businessId, contactId],
  );
}

export async function createContactCrmTask(
  businessId: string,
  contactId: number,
  input: ContactCrmTaskInput,
  actor: ContactCrmActor,
) {
  await requireContact(businessId, contactId);
  const title = cleanRequired(input.title, 'Task title', 255);
  const description = cleanOptional(input.description, 5_000);
  const dueDate = cleanDate(input.dueDate);
  const priority = String(input.priority ?? 'normal');
  if (!CRM_TASK_PRIORITIES.includes(priority as typeof CRM_TASK_PRIORITIES[number])) {
    throw new ContactCrmValidationError('Invalid task priority.');
  }
  const result = await imsExecute(
    `INSERT INTO ims_crm_tasks
       (business_id, contact_id, title, description, due_date, priority,
        assigned_user_id, assigned_user_name, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [businessId, contactId, title, description, dueDate, priority,
      input.assignedUserId ?? null, input.assignedUserName ?? null, actor.id, actor.name],
  );
  return Number(result.insertId);
}

export async function updateContactCrmTask(
  businessId: string,
  contactId: number,
  taskId: number,
  input: ContactCrmTaskInput & { status?: string },
  actor: ContactCrmActor,
) {
  await requireContact(businessId, contactId);
  const existing = await imsQuery<any>(
        `SELECT id, title, description, due_date, priority, status, assigned_user_id, assigned_user_name,
          completed_by, completed_by_name, completed_at
       FROM ims_crm_tasks WHERE id = ? AND business_id = ? AND contact_id = ? LIMIT 1`,
    [taskId, businessId, contactId],
  );
  if (!existing[0]) throw new ContactCrmNotFoundError('Task not found.');
  const status = String(input.status ?? existing[0].status);
  if (!CRM_TASK_STATUSES.includes(status as typeof CRM_TASK_STATUSES[number])) {
    throw new ContactCrmValidationError('Invalid task status.');
  }
  const title = input.title === undefined ? existing[0].title : cleanRequired(input.title, 'Task title', 255);
  const description = input.description === undefined ? existing[0].description : cleanOptional(input.description, 5_000);
  const dueDate = input.dueDate === undefined ? existing[0].due_date : cleanDate(input.dueDate);
  const priority = String(input.priority ?? existing[0].priority);
  if (!CRM_TASK_PRIORITIES.includes(priority as typeof CRM_TASK_PRIORITIES[number])) {
    throw new ContactCrmValidationError('Invalid task priority.');
  }
  const assignedUserId = input.assignedUserId === undefined ? existing[0].assigned_user_id : input.assignedUserId;
  const assignedUserName = input.assignedUserName === undefined ? existing[0].assigned_user_name : input.assignedUserName;
  const newlyCompleted = status === 'completed' && existing[0].status !== 'completed';
  const remainsCompleted = status === 'completed';
  await imsExecute(
    `UPDATE ims_crm_tasks
        SET title = ?, description = ?, due_date = ?, priority = ?, status = ?,
            assigned_user_id = ?, assigned_user_name = ?,
            completed_by = ?, completed_by_name = ?, completed_at = ?
      WHERE id = ? AND business_id = ? AND contact_id = ?`,
    [title, description, dueDate, priority, status, assignedUserId ?? null, assignedUserName ?? null,
      remainsCompleted ? (newlyCompleted ? actor.id : existing[0].completed_by) : null,
      remainsCompleted ? (newlyCompleted ? actor.name : existing[0].completed_by_name) : null,
      remainsCompleted ? (newlyCompleted ? new Date() : existing[0].completed_at) : null,
      taskId, businessId, contactId],
  );
}

export async function listContactCrmTags(businessId: string, contactId: number, requireExisting = true) {
  if (requireExisting) await requireContact(businessId, contactId);
  return imsQuery<any>(
    `SELECT t.id, t.name, t.color
       FROM ims_crm_contact_tags ct
       JOIN ims_crm_tags t ON t.id = ct.tag_id AND t.business_id = ct.business_id
      WHERE ct.business_id = ? AND ct.contact_id = ? ORDER BY t.name`,
    [businessId, contactId],
  );
}

export async function listContactCrmTagSuggestions(businessId: string) {
  return imsQuery<any>(
    `SELECT t.id, t.name, t.color, COUNT(ct.id) AS usage_count
       FROM ims_crm_tags t LEFT JOIN ims_crm_contact_tags ct ON ct.tag_id = t.id AND ct.business_id = t.business_id
      WHERE t.business_id = ? GROUP BY t.id, t.name, t.color ORDER BY usage_count DESC, t.name LIMIT 100`,
    [businessId],
  );
}

export async function addContactCrmTag(
  businessId: string,
  contactId: number,
  value: unknown,
  actor: ContactCrmActor,
) {
  await requireContact(businessId, contactId);
  const { name, normalizedName } = normalizeTagName(value);
  const tagResult = await imsExecute(
    `INSERT INTO ims_crm_tags (business_id, name, normalized_name, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [businessId, name, normalizedName, actor.id, actor.name],
  );
  const tagId = Number(tagResult.insertId);
  await imsExecute(
    `INSERT IGNORE INTO ims_crm_contact_tags
       (business_id, contact_id, tag_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)`,
    [businessId, contactId, tagId, actor.id, actor.name],
  );
  return tagId;
}

export async function removeContactCrmTag(businessId: string, contactId: number, tagId: number) {
  await requireContact(businessId, contactId);
  const result = await imsExecute(
    `DELETE FROM ims_crm_contact_tags WHERE business_id = ? AND contact_id = ? AND tag_id = ?`,
    [businessId, contactId, tagId],
  );
  if (!result.affectedRows) throw new ContactCrmNotFoundError('Tag assignment not found.');
}