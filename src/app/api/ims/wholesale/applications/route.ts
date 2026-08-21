import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { listWholesaleApplications } from '@/lib/wholesale/wholesaleApplicationReview';
import type { WholesaleApplicationStatus } from '@/lib/wholesale/wholesaleApplication';

const STATUSES = new Set<WholesaleApplicationStatus>(['pending_email', 'pending_review', 'approving', 'approved', 'rejected']);

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  try {
    const rawStatus = new URL(request.url).searchParams.get('status');
    const status = rawStatus && STATUSES.has(rawStatus as WholesaleApplicationStatus)
      ? rawStatus as WholesaleApplicationStatus
      : undefined;
    const applications = await listWholesaleApplications(session.businessId, status);
    return NextResponse.json({
      success: true,
      applications,
      canReview: ['Admin', 'SuperAdmin'].includes(session.tier ?? ''),
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims.wholesale_applications', operation: 'list',
      title: 'Wholesale applications could not be loaded', error,
    });
    return NextResponse.json({ error: 'Applications could not be loaded.' }, { status: 500 });
  }
}