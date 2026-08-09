import { NextResponse } from 'next/server';

import { getXeroMappingReadiness } from '@/lib/xero/mappingReadinessService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const databaseId = new URL(req.url).searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  try {
    return NextResponse.json({ success: true, ...(await getXeroMappingReadiness(databaseId!)) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: databaseId, source: 'xero_mapping_readiness', operation: 'load', title: 'Xero mapping readiness could not be checked', error });
    return NextResponse.json({ success: false, error: 'Live Xero mapping readiness could not be checked.' }, { status: 502 });
  }
}