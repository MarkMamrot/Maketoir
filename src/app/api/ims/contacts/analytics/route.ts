import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  ContactCrmAnalyticsValidationError,
  getContactCrmAnalytics,
} from '@/lib/ims/contactCrmAnalyticsService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function defaultFrom() {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);
  const params = new URL(request.url).searchParams;
  const from = params.get('from') || defaultFrom();
  const to = params.get('to') || new Date().toISOString().slice(0, 10);
  try {
    return NextResponse.json({ success: true, data: await getContactCrmAnalytics(businessId, from, to) });
  } catch (error) {
    if (error instanceof ContactCrmAnalyticsValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId, source: 'ims_crm', operation: 'load_analytics', title: 'CRM analytics failed', error,
      context: { from, to },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'CRM analytics could not be loaded.' }, { status: 500 });
  }
}