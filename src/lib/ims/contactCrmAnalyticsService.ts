import {
  buildCrmAnalytics,
  type CrmManualActivity,
  type CrmPurchaseEvent,
  type CrmTaskActivity,
} from '@/lib/ims/contactCrmAnalytics';
import { imsQuery } from '@/services/IMSMySQLService';

export class ContactCrmAnalyticsValidationError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getContactCrmAnalytics(businessId: string, from: string, to: string) {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    throw new ContactCrmAnalyticsValidationError('Choose a valid analytics date range.');
  }
  const [purchaseRows, taskRows, interactionRows] = await Promise.all([
    imsQuery<{
      contact_id: number; contact_name: string; occurred_at: string; amount: number; source: 'pos' | 'sales_order'; source_id: number;
    }>(
      `SELECT sale.customer_id AS contact_id, contact.name AS contact_name, sale.completed_at AS occurred_at,
              CASE WHEN sale.sale_type = 'return' THEN -ABS(sale.total) ELSE sale.total END AS amount,
              'pos' AS source, sale.id AS source_id
         FROM pos_sales sale
         JOIN ims_locations location ON location.id = sale.location_id AND location.business_id = ?
         JOIN ims_contacts contact ON contact.id = sale.customer_id AND contact.business_id = ?
        WHERE sale.status = 'completed' AND sale.completed_at IS NOT NULL AND sale.completed_at < DATE_ADD(?, INTERVAL 1 DAY)
          AND contact.type IN ('retail_customer','b2b_customer','both')
        UNION ALL
       SELECT so.customer_id AS contact_id, contact.name AS contact_name, CAST(so.fulfilled_date AS DATETIME) AS occurred_at,
              GREATEST(so.total_amount - COALESCE(so.refunded_amount, 0), 0) AS amount,
              'sales_order' AS source, so.id AS source_id
         FROM ims_sales_orders so
         JOIN ims_contacts contact ON contact.id = so.customer_id AND contact.business_id = so.business_id
        WHERE so.business_id = ? AND so.status = 'fulfilled' AND so.fulfilled_date IS NOT NULL
          AND so.fulfilled_date < DATE_ADD(?, INTERVAL 1 DAY)
          AND contact.type IN ('retail_customer','b2b_customer','both')`,
      [businessId, businessId, to, businessId, to],
    ),
    imsQuery<{
      id: number; contact_id: number; status: string; created_at: string; due_date: string | null;
      assigned_user_id: number | null; assigned_user_name: string | null; completed_at: string | null;
      completed_by: number | null; completed_by_name: string | null;
    }>(
      `SELECT id, contact_id, status, created_at, due_date, assigned_user_id, assigned_user_name,
              completed_at, completed_by, completed_by_name
         FROM ims_crm_tasks
        WHERE business_id = ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [businessId, to],
    ),
    imsQuery<{ actor_id: number | null; actor_name: string | null; occurred_at: string }>(
      `SELECT actor_id, actor_name, COALESCE(occurred_at, created_at) AS occurred_at
         FROM ims_crm_interactions
        WHERE business_id = ?
          AND COALESCE(occurred_at, created_at) >= ?
          AND COALESCE(occurred_at, created_at) < DATE_ADD(?, INTERVAL 1 DAY)`,
      [businessId, from, to],
    ),
  ]);
  const purchases: CrmPurchaseEvent[] = purchaseRows.map(row => ({
    contactId: Number(row.contact_id), contactName: String(row.contact_name), occurredAt: String(row.occurred_at),
    amount: Number(row.amount), source: row.source, sourceId: Number(row.source_id),
  }));
  const tasks: CrmTaskActivity[] = taskRows.map(row => ({
    id: Number(row.id), contactId: Number(row.contact_id), status: row.status, createdAt: String(row.created_at), dueDate: row.due_date,
    assignedUserId: row.assigned_user_id, assignedUserName: row.assigned_user_name, completedAt: row.completed_at,
    completedBy: row.completed_by, completedByName: row.completed_by_name,
  }));
  const interactions: CrmManualActivity[] = interactionRows.map(row => ({
    actorId: row.actor_id, actorName: row.actor_name, occurredAt: String(row.occurred_at),
  }));
  const analytics = buildCrmAnalytics({ purchases, tasks, interactions, from, to });
  return {
    ...analytics,
    lifetimeValue: { ...analytics.lifetimeValue, customers: analytics.lifetimeValue.customers.slice(0, 250) },
    rfm: analytics.rfm.slice(0, 500),
    customerResultsTruncated: analytics.rfm.length > 500,
  };
}