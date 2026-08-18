import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  addContactCrmTag,
  listContactCrmTags,
  listContactCrmTagSuggestions,
  removeContactCrmTag,
} from '@/lib/ims/contactCrmService';
import { crmActor, crmRouteError, crmWriteGuard } from '../../_crmRouteHelpers';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const contactId = Number(params.id);
  try {
    const [tags, suggestions] = await Promise.all([
      listContactCrmTags(session.businessId, contactId),
      listContactCrmTagSuggestions(session.businessId),
    ]);
    return NextResponse.json({ success: true, data: { tags, suggestions } });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'list_tags', contactId);
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
    const tagId = await addContactCrmTag(session.businessId, contactId, body.name, crmActor(session));
    return NextResponse.json({ success: true, tagId }, { status: 201 });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'add_tag', contactId);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  const contactId = Number(params.id);
  try {
    await removeContactCrmTag(session.businessId, contactId, Number(new URL(req.url).searchParams.get('tagId')));
    return NextResponse.json({ success: true });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'remove_tag', contactId);
  }
}