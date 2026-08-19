export interface CrmPurchaseEvent {
  contactId: number;
  contactName: string;
  occurredAt: string;
  amount: number;
  source: 'pos' | 'sales_order';
  sourceId: number;
}

export interface CrmTaskActivity {
  id: number;
  contactId: number;
  status: string;
  createdAt: string;
  dueDate?: string | null;
  assignedUserId?: number | null;
  assignedUserName?: string | null;
  completedAt?: string | null;
  completedBy?: number | null;
  completedByName?: string | null;
}

export interface CrmManualActivity {
  actorId?: number | null;
  actorName?: string | null;
  occurredAt: string;
}

export interface CrmAnalyticsInput {
  purchases: CrmPurchaseEvent[];
  tasks: CrmTaskActivity[];
  interactions: CrmManualActivity[];
  from: string;
  to: string;
  reactivationDays?: number;
  influenceDays?: number;
}

const DAY_MS = 86_400_000;

function time(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).getTime();
  return parsed;
}

function inRange(value: string, fromTime: number, toTime: number) {
  const valueTime = time(value);
  return valueTime >= fromTime && valueTime <= toTime;
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function quintileScores<T>(rows: T[], value: (row: T) => number, higherIsBetter: boolean): Map<T, number> {
  const sortedValues = rows.map(value).sort((a, b) => a - b);
  const result = new Map<T, number>();
  for (const row of rows) {
    const current = value(row);
    const rank = higherIsBetter
      ? sortedValues.filter(item => item <= current).length
      : sortedValues.filter(item => item >= current).length;
    result.set(row, Math.max(1, Math.min(5, Math.ceil((rank / Math.max(sortedValues.length, 1)) * 5))));
  }
  return result;
}

export function buildCrmAnalytics(input: CrmAnalyticsInput) {
  const fromTime = time(`${input.from}T00:00:00Z`);
  const toTime = time(`${input.to}T23:59:59Z`);
  const influenceDays = input.influenceDays ?? 30;
  const reactivationDays = input.reactivationDays ?? 90;
  const purchases = input.purchases
    .filter(event => time(event.occurredAt) <= toTime)
    .slice()
    .sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
  const byContact = new Map<number, CrmPurchaseEvent[]>();
  for (const event of purchases) {
    const events = byContact.get(event.contactId) ?? [];
    events.push(event);
    byContact.set(event.contactId, events);
  }

  const customerRows = [...byContact.entries()].map(([contactId, events]) => {
    const positive = events.filter(event => event.amount > 0);
    const lastPurchaseAt = positive.at(-1)?.occurredAt ?? null;
    return {
      contactId,
      contactName: events.at(-1)?.contactName ?? `Contact ${contactId}`,
      lifetimeValue: events.reduce((sum, event) => sum + event.amount, 0),
      frequency: positive.length,
      lastPurchaseAt,
      recencyDays: lastPurchaseAt ? Math.max(0, Math.floor((toTime - time(lastPurchaseAt)) / DAY_MS)) : 999999,
    };
  }).filter(row => row.frequency > 0);
  const recencyScores = quintileScores(customerRows, row => row.recencyDays, false);
  const frequencyScores = quintileScores(customerRows, row => row.frequency, true);
  const monetaryScores = quintileScores(customerRows, row => row.lifetimeValue, true);
  const customers = customerRows.map(row => ({
    ...row,
    recencyScore: recencyScores.get(row) ?? 1,
    frequencyScore: frequencyScores.get(row) ?? 1,
    monetaryScore: monetaryScores.get(row) ?? 1,
  })).sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  const monthBuyers = new Map<string, Set<number>>();
  const repeatBuyers = new Map<string, Set<number>>();
  const firstPurchase = new Map<number, number>();
  const reactivatedCustomers = new Set<number>();
  let reactivationRevenue = 0;
  for (const [contactId, events] of byContact) {
    const positive = events.filter(event => event.amount > 0);
    let previousTime: number | null = null;
    for (const event of positive) {
      const eventTime = time(event.occurredAt);
      if (!firstPurchase.has(contactId)) firstPurchase.set(contactId, eventTime);
      if (eventTime >= fromTime) {
        const month = monthKey(event.occurredAt);
        const buyers = monthBuyers.get(month) ?? new Set<number>();
        buyers.add(contactId);
        monthBuyers.set(month, buyers);
        if ((firstPurchase.get(contactId) ?? eventTime) < time(`${month}-01T00:00:00Z`)) {
          const repeats = repeatBuyers.get(month) ?? new Set<number>();
          repeats.add(contactId);
          repeatBuyers.set(month, repeats);
        }
        if (previousTime !== null && eventTime - previousTime >= reactivationDays * DAY_MS) {
          reactivatedCustomers.add(contactId);
          reactivationRevenue += event.amount;
        }
      }
      previousTime = eventTime;
    }
  }
  const retention = [...monthBuyers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, buyers]) => {
    const repeats = repeatBuyers.get(month)?.size ?? 0;
    return { month, purchasingCustomers: buyers.size, repeatCustomers: repeats, retentionRate: buyers.size ? repeats / buyers.size : 0 };
  });

  const tasksCompletedInRange = input.tasks.filter(task => task.completedAt && inRange(task.completedAt, fromTime, toTime));
  const tasksCreatedInRange = input.tasks.filter(task => inRange(task.createdAt, fromTime, toTime));
  const createdTasksCompleted = tasksCreatedInRange.filter(task => task.completedAt && time(task.completedAt) <= toTime);
  const openTasks = input.tasks.filter(task => task.status === 'open');
  const overdueTasks = openTasks.filter(task => task.dueDate && time(`${task.dueDate}T23:59:59Z`) < toTime);
  const advisorMap = new Map<string, { userId: number | null; name: string; completedTasks: number; manualInteractions: number; influencedRevenue: number }>();
  const advisor = (id: number | null | undefined, name: string | null | undefined) => {
    const key = id == null ? `name:${name || 'Unknown user'}` : `id:${id}`;
    const current = advisorMap.get(key) ?? { userId: id ?? null, name: name || 'Unknown user', completedTasks: 0, manualInteractions: 0, influencedRevenue: 0 };
    advisorMap.set(key, current);
    return current;
  };
  for (const task of tasksCompletedInRange) advisor(task.completedBy, task.completedByName).completedTasks += 1;
  for (const interaction of input.interactions.filter(item => inRange(item.occurredAt, fromTime, toTime))) {
    advisor(interaction.actorId, interaction.actorName).manualInteractions += 1;
  }

  const completedByContact = new Map<number, CrmTaskActivity[]>();
  for (const task of input.tasks.filter(item => item.completedAt)) {
    const tasks = completedByContact.get(task.contactId) ?? [];
    tasks.push(task);
    completedByContact.set(task.contactId, tasks);
  }
  let influencedRevenue = 0;
  let influencedTransactions = 0;
  for (const purchase of purchases.filter(event => event.amount > 0 && inRange(event.occurredAt, fromTime, toTime))) {
    const purchaseTime = time(purchase.occurredAt);
    const influencingTask = (completedByContact.get(purchase.contactId) ?? [])
      .filter(task => {
        const completedTime = time(task.completedAt);
        return completedTime <= purchaseTime && purchaseTime - completedTime <= influenceDays * DAY_MS;
      })
      .sort((a, b) => time(b.completedAt) - time(a.completedAt))[0];
    if (!influencingTask) continue;
    influencedRevenue += purchase.amount;
    influencedTransactions += 1;
    advisor(influencingTask.completedBy, influencingTask.completedByName).influencedRevenue += purchase.amount;
  }

  return {
    lifetimeValue: {
      total: customers.reduce((sum, customer) => sum + customer.lifetimeValue, 0),
      average: customers.length ? customers.reduce((sum, customer) => sum + customer.lifetimeValue, 0) / customers.length : 0,
      customers,
    },
    rfm: customers,
    retention,
    reactivation: { customers: reactivatedCustomers.size, revenue: reactivationRevenue, inactivityDays: reactivationDays },
    tasks: {
      created: tasksCreatedInRange.length,
      completed: tasksCompletedInRange.length,
      completionRate: tasksCreatedInRange.length ? createdTasksCompleted.length / tasksCreatedInRange.length : 0,
      open: openTasks.length,
      overdue: overdueTasks.length,
    },
    advisors: [...advisorMap.values()].sort((a, b) => b.completedTasks + b.manualInteractions - a.completedTasks - a.manualInteractions),
    influenced: { revenue: influencedRevenue, transactions: influencedTransactions, windowDays: influenceDays },
  };
}