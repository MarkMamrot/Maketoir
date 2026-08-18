import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getContactCrmWorkspace } from '@/lib/ims/contactCrmService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await getContactCrmWorkspace(session.businessId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims_crm',
      operation: 'load_workspace',
      title: 'CRM workspace could not be loaded',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'CRM workspace could not be loaded.' }, { status: 500 });
  }
}