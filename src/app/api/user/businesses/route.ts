import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/sessionUtils';
import { resolveActorBusinessAccess } from '@/lib/auth/businessAccess';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  let activeBusinessId: string | undefined;
  try {
    const session = getAdminSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
    }
    activeBusinessId = session.businessId;

    const access = await resolveActorBusinessAccess(session.userId);
    if (!access) {
      return NextResponse.json({ success: false, error: 'Account not found.' }, { status: 403 });
    }

    const businesses = access.businesses.map(business => ({
      name: business.name,
      databaseId: business.businessId,
      folderId: business.driveFolderId ?? '',
      active: business.businessId === session.businessId,
      hasForesight: business.hasForesight,
      hasIms: business.hasIms,
      hasPos: business.hasPos,
      isSandbox: business.isSandbox,
      tier: business.tier,
    }));

    return NextResponse.json({ success: true, activeBusinessId: session.businessId, businesses });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: activeBusinessId,
      source: 'auth',
      operation: 'accessible_businesses_load',
      severity: 'error',
      title: 'Accessible businesses could not be loaded',
      error,
    }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Businesses could not be loaded.' }, { status: 500 });
  }
}
