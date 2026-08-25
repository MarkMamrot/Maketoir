import { ImsContactsRepo } from '@/lib/ims/ImsRepository';
import { isCrmCustomerType, isRetailCrmType } from '@/lib/ims/contactCrmAccess';
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

export interface ContactCrmWorkspaceMeta {
  openTaskCount: number;
  overdueTaskCount: number;
  lastInteractionAt: string | Date | null;
  tags: Array<{ id: number; name: string; color: string | null }>;
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

export function normalizeContactCrmInteractionBrief(value: unknown): string | null {
  return cleanOptional(value, 4000);
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
  if (!isCrmCustomerType(contact.type)) throw new ContactCrmValidationError('This contact is not eligible for CRM.');
  return contact;
}

export async function getContactCrmProfile(businessId: string, contactId: number) {
  const contact = await requireContact(businessId, contactId);
  const includeRetailData = isRetailCrmType(contact.type);
  const [posSummary, orderSummary, creditSummary, loyalty, tags, taskSummary] = await Promise.all([
    includeRetailData ? imsQuery<any>(
      `SELECT COUNT(*) AS transaction_count,
              COALESCE(SUM(CASE WHEN ps.sale_type = 'return' THEN -ABS(ps.total) ELSE ps.total END), 0) AS net_total,
              MAX(COALESCE(ps.completed_at, ps.created_at)) AS last_activity_at
         FROM pos_sales ps
         JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
        WHERE ps.customer_id = ? AND ps.status NOT IN ('open','parked','voided')`,
      [businessId, contactId],
    ) : Promise.resolve([]),
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
    includeRetailData ? imsQuery<any>(
      `SELECT balance_points, lifetime_earned, lifetime_redeemed, status
         FROM loyalty_accounts WHERE business_id = ? AND contact_id = ? LIMIT 1`,
      [businessId, contactId],
    ) : Promise.resolve([]),
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
      pos: includeRetailData ? posSummary[0] ?? { transaction_count: 0, net_total: 0, last_activity_at: null } : null,
      salesOrders: orderSummary[0] ?? { order_count: 0, order_total: 0, last_activity_at: null },
      creditNotes: creditSummary[0] ?? { credit_count: 0, credit_total: 0, last_activity_at: null },
      loyalty: includeRetailData ? loyalty[0] ?? null : null,
      storeCredit: Number(contact.store_credit ?? 0),
      tasks: taskSummary[0] ?? { open_count: 0, overdue_count: 0 },
    },
    tags,
  };
}

export async function updateContactCrmInteractionBrief(businessId: string, contactId: number, value: unknown) {
  await requireContact(businessId, contactId);
  const notes = normalizeContactCrmInteractionBrief(value);
  await imsExecute(
    'UPDATE ims_contacts SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?',
    [notes, contactId, businessId],
  );
  return notes;
}

export async function getContactCrmTimeline(
  businessId: string,
  contactId: number,
  options: { categories?: ContactCrmActivityCategory[]; from?: string; to?: string; limit?: number } = {},
): Promise<{ entries: ContactCrmTimelineEntry[]; truncated: boolean }> {
  const contact = await requireContact(businessId, contactId);
  const includeRetailData = isRetailCrmType(contact.type);
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 100), 200));
  const sourceLimit = 200;
  const from = DATE_RE.test(options.from ?? '') ? options.from as string : null;
  const to = DATE_RE.test(options.to ?? '') ? options.to as string : null;
  const dateSql = (expression: string) => `${from ? ` AND DATE(${expression}) >= ?` : ''}${to ? ` AND DATE(${expression}) <= ?` : ''}`;
  const dateParams = () => [from, to].filter((value): value is string => Boolean(value));
  const [posSales, salesOrders, creditNotes, storeCreditTransactions, loyaltyTransactions, interactions, tasks] = await Promise.all([
    includeRetailData ? imsQuery<any>(
      `SELECT ps.id, ps.sale_type, ps.status, ps.total, ps.cashier_name, ps.created_at, ps.completed_at, l.name AS location_name
         FROM pos_sales ps
         JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
        WHERE ps.customer_id = ?${dateSql('COALESCE(ps.completed_at, ps.created_at)')}
        ORDER BY COALESCE(ps.completed_at, ps.created_at) DESC LIMIT ${sourceLimit}`,
      [businessId, contactId, ...dateParams()],
    ) : Promise.resolve([]),
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
    includeRetailData ? imsQuery<any>(
      `SELECT lt.id, lt.type, lt.points_delta, lt.balance_after, lt.channel, lt.actor_id, lt.created_at
         FROM loyalty_transactions lt
         JOIN loyalty_accounts la ON la.id = lt.account_id AND la.business_id = ? AND la.contact_id = ?
        WHERE lt.business_id = ?${dateSql('lt.created_at')} ORDER BY lt.created_at DESC LIMIT ${sourceLimit}`,
      [businessId, contactId, businessId, ...dateParams()],
    ) : Promise.resolve([]),
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

export async function getContactCrmWorkspace(businessId: string) {
  const [tasks, taskSummaries, interactionSummaries, contactTags, tags] = await Promise.all([
    imsQuery<any>(
      `SELECT t.id, t.contact_id, c.name AS contact_name, c.company AS contact_company,
              t.title, t.description, t.due_date, t.priority, t.status,
              t.assigned_user_id, t.assigned_user_name, t.created_at
         FROM ims_crm_tasks t
         JOIN ims_contacts c ON c.id = t.contact_id AND c.business_id = t.business_id
        WHERE t.business_id = ? AND t.status = 'open'
          AND c.type IN ('lead','retail_customer','b2b_customer','both')
        ORDER BY t.due_date IS NULL, t.due_date, FIELD(t.priority, 'high', 'normal', 'low'), t.id DESC
        LIMIT 501`,
      [businessId],
    ),
    imsQuery<any>(
      `SELECT crm_task.contact_id, COUNT(*) AS open_task_count,
              SUM(due_date IS NOT NULL AND due_date < CURRENT_DATE) AS overdue_task_count
         FROM ims_crm_tasks crm_task
         JOIN ims_contacts c ON c.id = crm_task.contact_id AND c.business_id = crm_task.business_id
        WHERE crm_task.business_id = ? AND crm_task.status = 'open'
          AND c.type IN ('lead','retail_customer','b2b_customer','both')
        GROUP BY crm_task.contact_id`,
      [businessId],
    ),
    imsQuery<any>(
      `SELECT interaction.contact_id, MAX(COALESCE(interaction.occurred_at, interaction.created_at)) AS last_interaction_at
        FROM ims_crm_interactions interaction
        JOIN ims_contacts c ON c.id = interaction.contact_id AND c.business_id = interaction.business_id
        WHERE interaction.business_id = ? AND c.type IN ('lead','retail_customer','b2b_customer','both')
        GROUP BY interaction.contact_id`,
      [businessId],
    ),
    imsQuery<any>(
      `SELECT ct.contact_id, t.id, t.name, t.color
         FROM ims_crm_contact_tags ct
         JOIN ims_crm_tags t ON t.id = ct.tag_id AND t.business_id = ct.business_id
         JOIN ims_contacts c ON c.id = ct.contact_id AND c.business_id = ct.business_id
        WHERE ct.business_id = ? AND c.type IN ('lead','retail_customer','b2b_customer','both')
        ORDER BY t.name`,
      [businessId],
    ),
    listContactCrmTagSuggestions(businessId),
  ]);

  const contactMeta: Record<number, ContactCrmWorkspaceMeta> = {};
  const ensureMeta = (contactId: number) => contactMeta[contactId] ??= {
    openTaskCount: 0,
    overdueTaskCount: 0,
    lastInteractionAt: null,
    tags: [],
  };
  for (const row of taskSummaries) {
    const meta = ensureMeta(Number(row.contact_id));
    meta.openTaskCount = Number(row.open_task_count ?? 0);
    meta.overdueTaskCount = Number(row.overdue_task_count ?? 0);
  }
  for (const row of interactionSummaries) {
    ensureMeta(Number(row.contact_id)).lastInteractionAt = row.last_interaction_at ?? null;
  }
  for (const row of contactTags) {
    ensureMeta(Number(row.contact_id)).tags.push({
      id: Number(row.id),
      name: String(row.name),
      color: row.color == null ? null : String(row.color),
    });
  }

  return { tasks: tasks.slice(0, 500), taskTruncated: tasks.length > 500, contactMeta, tags };
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