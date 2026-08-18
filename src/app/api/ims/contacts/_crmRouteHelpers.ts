import { NextResponse } from 'next/server';

import type { MarketoirSession } from '@/lib/auth/imsSession';
import {
  ContactCrmNotFoundError,
  ContactCrmValidationError,
  type ContactCrmActor,
} from '@/lib/ims/contactCrmService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';

export function crmActor(session: MarketoirSession): ContactCrmActor {
  return {
    id: session.userId == null ? null : Number(session.userId),
    name: String(session.name || session.email || 'Unknown user').trim(),
  };
}

export function crmWriteGuard(session: MarketoirSession) {
  return session.tier === 'Advisor'
    ? NextResponse.json({ success: false, error: 'Advisor accounts are read-only.' }, { status: 403 })
    : null;
}

export async function resolveCrmAssignee(businessId: string, value: unknown) {
  if (value === null || value === undefined || value === '') return { id: null, name: null };
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) throw new ContactCrmValidationError('Invalid assignee.');
  const users = await query<{ id: number; name: string | null; email: string | null }>(
    `SELECT id, name, email FROM users
      WHERE id = ? AND business_id = ? AND deleted_at IS NULL LIMIT 1`,
    [userId, businessId],
  );
  if (!users[0]) throw new ContactCrmValidationError('Assignee is not an active user in this business.');
  return { id: Number(users[0].id), name: String(users[0].name || users[0].email || `User ${users[0].id}`) };
}

export async function crmRouteError(
  error: unknown,
  businessId: string,
  operation: string,
  contactId: number,
) {
  if (error instanceof ContactCrmValidationError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
  if (error instanceof ContactCrmNotFoundError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 404 });
  }
  await reportRuntimeIssue({
    businessId,
    source: 'ims_crm',
    operation,
    title: 'CRM operation failed',
    error,
    reference: { type: 'contact', id: contactId },
  }).catch(() => {});
  return NextResponse.json(
    { success: false, error: error instanceof Error ? error.message : 'CRM operation failed.' },
    { status: 500 },
  );
}