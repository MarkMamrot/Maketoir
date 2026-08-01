import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import { parseXeroDocumentPolicy } from '@/lib/xero/documentPolicies';
import {
  getXeroDocumentPolicy,
  saveXeroDocumentPolicy,
} from '@/lib/xero/documentPolicyRepository';

export async function GET(request: Request) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;
  const databaseId = new URL(request.url).searchParams.get('databaseId');
  const denied = assertBusinessAccess(auth.user, databaseId);
  if (denied) return denied;

  try {
    const policy = await getXeroDocumentPolicy(databaseId!);
    return NextResponse.json({ success: true, policy });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: databaseId,
      source: 'XeroDocumentPolicies',
      operation: 'load_policy',
      title: 'Failed to load Xero document policy',
      error,
    });
    return NextResponse.json({ success: false, error: 'Failed to load document policy.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;
  const body = await request.json();
  const databaseId = typeof body.databaseId === 'string' ? body.databaseId : null;
  const denied = assertBusinessAccess(auth.user, databaseId);
  if (denied) return denied;

  let policy;
  try {
    policy = parseXeroDocumentPolicy(body.policy);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid document policy.',
    }, { status: 400 });
  }

  try {
    await saveXeroDocumentPolicy(databaseId!, policy);
    return NextResponse.json({ success: true, policy });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: databaseId,
      source: 'XeroDocumentPolicies',
      operation: 'save_policy',
      title: 'Failed to save Xero document policy',
      error,
    });
    return NextResponse.json({ success: false, error: 'Failed to save document policy.' }, { status: 500 });
  }
}