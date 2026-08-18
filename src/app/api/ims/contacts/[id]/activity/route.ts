import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getContactCrmTimeline } from '@/lib/ims/contactCrmService';
import type { ContactCrmActivityCategory } from '@/lib/ims/contactCrmTimeline';
import { crmRouteError } from '../../_crmRouteHelpers';

const CATEGORIES = new Set<ContactCrmActivityCategory>(['sale', 'order', 'credit', 'loyalty', 'interaction', 'task']);

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const contactId = Number(params.id);
  const searchParams = new URL(req.url).searchParams;
  const categories = (searchParams.get('categories') ?? '').split(',')
    .filter((value): value is ContactCrmActivityCategory => CATEGORIES.has(value as ContactCrmActivityCategory));
  try {
    const data = await getContactCrmTimeline(session.businessId, contactId, {
      categories,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      limit: Number(searchParams.get('limit') ?? 100),
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'load_activity', contactId);
  }
}