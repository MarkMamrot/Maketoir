import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import {
  XERO_DOCUMENT_POLICY_PRESETS,
  diffXeroDocumentPolicy,
  getXeroDocumentPolicyPreset,
  getXeroDocumentPolicyWarnings,
  isXeroDocumentPolicyPresetKey,
  parseXeroDocumentPolicy,
} from '@/lib/xero/documentPolicies';
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
    return NextResponse.json({
      success: true, policy, warnings: getXeroDocumentPolicyWarnings(policy),
      presets: Object.entries(XERO_DOCUMENT_POLICY_PRESETS).map(([key, preset]) => ({ key, label: preset.label, policy: preset.policy })),
    });
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
  if (!['Admin', 'SuperAdmin'].includes(auth.user.tier)) {
    return NextResponse.json({ success: false, error: 'Only an Admin can change Xero document policy.' }, { status: 403 });
  }
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
  const presetSource = body.presetSource == null || body.presetSource === '' ? null : body.presetSource;
  if (presetSource !== null) {
    if (!isXeroDocumentPolicyPresetKey(presetSource)) {
      return NextResponse.json({ success: false, error: 'Unknown document policy preset.' }, { status: 400 });
    }
    if (diffXeroDocumentPolicy(getXeroDocumentPolicyPreset(presetSource), policy).length > 0) {
      return NextResponse.json({ success: false, error: 'Preset source does not match the submitted document policy.' }, { status: 400 });
    }
  }

  try {
    const saved = await saveXeroDocumentPolicy({
      businessId: databaseId!, policy, actorId: auth.user.userId, actorName: auth.user.name, presetSource,
    });
    return NextResponse.json({
      success: true, policy, changedFields: saved.changedFields,
      warnings: getXeroDocumentPolicyWarnings(policy),
    });
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