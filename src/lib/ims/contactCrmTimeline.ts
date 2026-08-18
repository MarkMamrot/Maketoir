export type ContactCrmActivityCategory = 'sale' | 'order' | 'credit' | 'loyalty' | 'interaction' | 'task';

export interface ContactCrmSourceReference {
  type: 'pos_sale' | 'sales_order' | 'credit_note';
  id: number;
}

export interface ContactCrmTimelineEntry {
  entryKey: string;
  category: ContactCrmActivityCategory;
  activityType: string;
  occurredAt: string;
  title: string;
  summary: string;
  actorName: string | null;
  status: string | null;
  amount: number | null;
  points: number | null;
  source: ContactCrmSourceReference | null;
}

export interface ContactCrmTimelineSources {
  posSales?: Array<Record<string, unknown>>;
  salesOrders?: Array<Record<string, unknown>>;
  creditNotes?: Array<Record<string, unknown>>;
  storeCreditTransactions?: Array<Record<string, unknown>>;
  loyaltyTransactions?: Array<Record<string, unknown>>;
  interactions?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
}

export interface ContactCrmTimelineOptions {
  categories?: ContactCrmActivityCategory[];
  from?: string;
  to?: string;
  limit?: number;
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const valueText = text(value).trim();
  return valueText || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function occurredAt(value: unknown): string {
  return value instanceof Date ? value.toISOString() : text(value);
}

function signedAmount(type: string, value: unknown): number | null {
  const amount = numberOrNull(value);
  if (amount === null) return null;
  if (type === 'redeem') return -Math.abs(amount);
  if (type === 'issue') return Math.abs(amount);
  return amount;
}

function titleCase(value: unknown): string {
  return text(value).replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeSources(sources: ContactCrmTimelineSources): ContactCrmTimelineEntry[] {
  const entries: ContactCrmTimelineEntry[] = [];

  for (const row of sources.posSales ?? []) {
    const id = Number(row.id);
    const isReturn = row.sale_type === 'return';
    const amount = numberOrNull(row.total);
    entries.push({
      entryKey: `pos-sale:${id}`,
      category: 'sale',
      activityType: isReturn ? 'pos_return' : 'pos_sale',
      occurredAt: occurredAt(row.completed_at ?? row.created_at),
      title: isReturn ? 'POS return' : 'POS sale',
      summary: nullableText(row.location_name) ?? nullableText(row.cashier_name) ?? 'Point of sale',
      actorName: nullableText(row.cashier_name),
      status: nullableText(row.status),
      amount: amount === null ? null : isReturn ? -Math.abs(amount) : amount,
      points: null,
      source: { type: 'pos_sale', id },
    });
  }

  for (const row of sources.salesOrders ?? []) {
    const id = Number(row.id);
    const number = nullableText(row.so_number) ?? `#${id}`;
    entries.push({
      entryKey: `sales-order:${id}`,
      category: 'order',
      activityType: 'sales_order',
      occurredAt: occurredAt(row.fulfilled_date ?? row.created_at ?? row.order_date),
      title: `Sales order ${number}`,
      summary: `${titleCase(row.so_type || 'sales')} order`,
      actorName: null,
      status: nullableText(row.status),
      amount: numberOrNull(row.total_amount),
      points: null,
      source: { type: 'sales_order', id },
    });
  }

  for (const row of sources.creditNotes ?? []) {
    const id = Number(row.id);
    const amount = numberOrNull(row.total_amount);
    entries.push({
      entryKey: `credit-note:${id}`,
      category: 'credit',
      activityType: 'credit_note',
      occurredAt: occurredAt(row.completed_at ?? row.created_at ?? row.cn_date),
      title: `Credit note ${nullableText(row.cn_number) ?? `#${id}`}`,
      summary: `${titleCase(row.source || 'manual')} customer credit`,
      actorName: nullableText(row.created_by),
      status: nullableText(row.status),
      amount: amount === null ? null : -Math.abs(amount),
      points: null,
      source: { type: 'credit_note', id },
    });
  }

  for (const row of sources.storeCreditTransactions ?? []) {
    const id = Number(row.id);
    const type = text(row.type);
    entries.push({
      entryKey: `store-credit:${id}`,
      category: 'credit',
      activityType: `store_credit_${type}`,
      occurredAt: occurredAt(row.created_at),
      title: `Store credit ${titleCase(type)}`,
      summary: row.balance_after == null ? 'Store credit ledger' : `Balance $${Number(row.balance_after).toFixed(2)}`,
      actorName: null,
      status: null,
      amount: signedAmount(type, row.amount),
      points: null,
      source: null,
    });
  }

  for (const row of sources.loyaltyTransactions ?? []) {
    const id = Number(row.id);
    const type = text(row.type);
    entries.push({
      entryKey: `loyalty:${id}`,
      category: 'loyalty',
      activityType: `loyalty_${type}`,
      occurredAt: occurredAt(row.created_at),
      title: `Loyalty ${titleCase(type)}`,
      summary: row.balance_after == null ? 'Loyalty ledger' : `Balance ${Number(row.balance_after)} points`,
      actorName: nullableText(row.actor_name ?? row.actor_id),
      status: nullableText(row.channel),
      amount: null,
      points: numberOrNull(row.points_delta),
      source: null,
    });
  }

  for (const row of sources.interactions ?? []) {
    const id = Number(row.id);
    const type = text(row.interaction_type || 'note');
    entries.push({
      entryKey: `interaction:${id}`,
      category: 'interaction',
      activityType: `interaction_${type}`,
      occurredAt: occurredAt(row.occurred_at ?? row.created_at),
      title: titleCase(type),
      summary: text(row.body),
      actorName: nullableText(row.actor_name),
      status: null,
      amount: null,
      points: null,
      source: null,
    });
  }

  for (const row of sources.tasks ?? []) {
    const id = Number(row.id);
    entries.push({
      entryKey: `task-created:${id}`,
      category: 'task',
      activityType: 'task_created',
      occurredAt: occurredAt(row.created_at),
      title: `Task created: ${text(row.title)}`,
      summary: row.due_date ? `Due ${text(row.due_date)}` : 'No due date',
      actorName: nullableText(row.created_by_name),
      status: nullableText(row.status),
      amount: null,
      points: null,
      source: null,
    });
    if (row.completed_at) {
      entries.push({
        entryKey: `task-completed:${id}`,
        category: 'task',
        activityType: 'task_completed',
        occurredAt: occurredAt(row.completed_at),
        title: `Task completed: ${text(row.title)}`,
        summary: nullableText(row.assigned_user_name) ?? 'Follow-up completed',
        actorName: nullableText(row.completed_by_name),
        status: 'completed',
        amount: null,
        points: null,
        source: null,
      });
    }
  }

  return entries;
}

export function buildContactCrmTimeline(
  sources: ContactCrmTimelineSources,
  options: ContactCrmTimelineOptions = {},
): ContactCrmTimelineEntry[] {
  const categorySet = options.categories?.length ? new Set(options.categories) : null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(options.from ?? '') ? options.from as string : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(options.to ?? '') ? options.to as string : null;
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 100), 200));

  return normalizeSources(sources)
    .filter(entry => !categorySet || categorySet.has(entry.category))
    .filter(entry => !from || entry.occurredAt.slice(0, 10) >= from)
    .filter(entry => !to || entry.occurredAt.slice(0, 10) <= to)
    .sort((left, right) => {
      const timestampOrder = right.occurredAt.localeCompare(left.occurredAt);
      return timestampOrder || right.entryKey.localeCompare(left.entryKey);
    })
    .slice(0, limit);
}