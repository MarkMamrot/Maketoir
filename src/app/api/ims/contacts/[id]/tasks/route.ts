import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { createContactCrmTask, listContactCrmTasks } from '@/lib/ims/contactCrmService';
import { crmActor, crmRouteError, crmWriteGuard, resolveCrmAssignee } from '../../_crmRouteHelpers';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const contactId = Number(params.id);
  try {
    return NextResponse.json({ success: true, data: await listContactCrmTasks(session.businessId, contactId) });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'list_tasks', contactId);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  const contactId = Number(params.id);
  try {
    const body = await req.json();
    const assignee = await resolveCrmAssignee(session.businessId, body.assignedUserId);
    const id = await createContactCrmTask(session.businessId, contactId, {
      ...body,
      assignedUserId: assignee.id,
      assignedUserName: assignee.name,
    }, crmActor(session));
    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'create_task', contactId);
  }
}