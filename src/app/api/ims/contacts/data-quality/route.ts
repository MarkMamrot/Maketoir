import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { listDuplicateContactCandidates } from '@/lib/ims/contactDataQualityService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);
  try {
    return NextResponse.json({ success: true, data: await listDuplicateContactCandidates(businessId) });
  } catch (error) {
    await reportRuntimeIssue({
      businessId, source: 'ims_crm', operation: 'list_duplicate_contacts',
      title: 'Duplicate contact scan failed', error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Duplicate contacts could not be loaded.' }, { status: 500 });
  }
}