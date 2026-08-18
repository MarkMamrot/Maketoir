import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { updateContactCrmTask } from '@/lib/ims/contactCrmService';
import { crmActor, crmRouteError, crmWriteGuard, resolveCrmAssignee } from '../../../_crmRouteHelpers';

export async function PATCH(req: Request, { params }: { params: { id: string; taskId: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  const contactId = Number(params.id);
  try {
    const body = await req.json();
    const assignee = body.assignedUserId === undefined
      ? {}
      : await resolveCrmAssignee(session.businessId, body.assignedUserId);
    await updateContactCrmTask(session.businessId, contactId, Number(params.taskId), {
      ...body,
      ...(body.assignedUserId === undefined ? {} : {
        assignedUserId: assignee.id,
        assignedUserName: assignee.name,
      }),
    }, crmActor(session));
    return NextResponse.json({ success: true });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'update_task', contactId);
  }
}