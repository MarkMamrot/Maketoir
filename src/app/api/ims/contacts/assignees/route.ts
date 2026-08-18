import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await query<{ id: number; name: string | null; email: string | null }>(
      `SELECT id, name, email FROM users
        WHERE business_id = ? AND deleted_at IS NULL ORDER BY COALESCE(name, email) LIMIT 200`,
      [session.businessId],
    );
    return NextResponse.json({
      success: true,
      data: data.map(user => ({ id: Number(user.id), name: String(user.name || user.email || `User ${user.id}`) })),
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims_crm',
      operation: 'list_assignees',
      title: 'CRM assignees could not be loaded',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Assignees could not be loaded.' }, { status: 500 });
  }
}