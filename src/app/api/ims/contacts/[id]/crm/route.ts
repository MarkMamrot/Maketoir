import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getContactCrmProfile } from '@/lib/ims/contactCrmService';
import { crmRouteError } from '../../_crmRouteHelpers';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const contactId = Number(params.id);
  try {
    return NextResponse.json({ success: true, data: await getContactCrmProfile(session.businessId, contactId) });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'load_profile', contactId);
  }
}