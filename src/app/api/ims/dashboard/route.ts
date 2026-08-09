import { NextResponse } from 'next/server';
import { ImsDashboardRepo } from '@/lib/ims/ImsRepository';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsDashboardRepo.getStats(businessId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims-dashboard',
      operation: 'load_stats',
      title: 'IMS dashboard statistics failed to load',
      error: e,
    });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
