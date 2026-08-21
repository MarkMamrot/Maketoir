import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getActiveWholesaleBuyer } from '@/lib/wholesale/wholesaleIdentity';
import {
  requireActiveWholesaleSession,
  signWholesaleSession,
  signWholesalePreviewSession,
  WHOLESALE_PREVIEW_SESSION_COOKIE,
  WHOLESALE_PREVIEW_SESSION_MAX_AGE,
  WHOLESALE_SESSION_COOKIE,
  WHOLESALE_SESSION_MAX_AGE,
} from '@/lib/wholesale/wholesaleSession';

export async function POST(request: Request) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;

  let locationId: number;
  try {
    const body = await request.json();
    locationId = Number(body.locationId);
    if (!Number.isSafeInteger(locationId) || locationId <= 0) throw new Error();
  } catch {
    return NextResponse.json({ error: 'Select a valid buying location.' }, { status: 400 });
  }

  try {
    const buyer = await getActiveWholesaleBuyer(session.businessId, session.contactId, locationId);
    if (!buyer || buyer.companyId !== session.companyId || buyer.memberId !== session.memberId) {
      return NextResponse.json({ error: 'That buying location is not available to your account.' }, { status: 403 });
    }
    const cookieName = session.preview ? WHOLESALE_PREVIEW_SESSION_COOKIE : WHOLESALE_SESSION_COOKIE;
    const signedSession = {
      ...session,
      email: buyer.email,
      name: buyer.name,
      company: buyer.company,
      companyId: buyer.companyId,
      locationId: buyer.locationId,
      memberId: buyer.memberId,
      memberRole: buyer.memberRole,
    };
    cookies().set(cookieName, session.preview ? signWholesalePreviewSession(signedSession) : signWholesaleSession(signedSession), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: session.preview ? WHOLESALE_PREVIEW_SESSION_MAX_AGE : WHOLESALE_SESSION_MAX_AGE,
      path: '/',
    });
    return NextResponse.json({ success: true, locationId });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'wholesale_portal',
      operation: 'switch_buying_location',
      title: 'Wholesale buying location could not be switched',
      error,
      reference: { type: 'wholesale_location', id: locationId },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The buying location could not be switched.' }, { status: 500 });
  }
}