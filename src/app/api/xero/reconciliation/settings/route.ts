import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import { isValidBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { parseReconciliationRecipients } from '@/lib/xero/reconciliation/email';
import { getXeroReconciliationEmailSettings, saveXeroReconciliationEmailSettings } from '@/lib/xero/reconciliation/repository';

const ALLOWED_TIERS = new Set(['Admin', 'SuperAdmin', 'Advisor']);

export async function GET(request: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  if (!ALLOWED_TIERS.has(user.tier)) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  const databaseId = new URL(request.url).searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  try {
    return NextResponse.json({ settings: await getXeroReconciliationEmailSettings(databaseId!) });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: databaseId, source: 'xero_reconciliation', operation: 'load_email_settings',
      title: 'Xero reconciliation email settings could not be loaded', error,
    });
    return NextResponse.json({ error: 'Reconciliation email settings could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  if (!['Admin', 'SuperAdmin'].includes(user.tier)) {
    return NextResponse.json({ error: 'Only an Admin can change accounts recipients.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const databaseId = typeof body.databaseId === 'string' ? body.databaseId : null;
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  const { recipients, invalid } = parseReconciliationRecipients(body.recipients);
  if (invalid.length) return NextResponse.json({ error: `Invalid email address: ${invalid[0]}` }, { status: 400 });
  if (recipients.length > 20) return NextResponse.json({ error: 'A maximum of 20 accounts recipients is allowed.' }, { status: 400 });
  const digestFrequency = ['daily', 'weekly'].includes(body.digestFrequency) ? body.digestFrequency as 'daily' | 'weekly' : 'off';
  const digestTimeZone = typeof body.digestTimeZone === 'string' ? body.digestTimeZone.trim() : 'Australia/Sydney';
  const digestHour = Number(body.digestHour ?? 8);
  const digestWeeklyDay = Number(body.digestWeeklyDay ?? 1);
  if (digestFrequency !== 'off' && recipients.length === 0) {
    return NextResponse.json({ error: 'Add at least one accounts recipient before enabling digests.' }, { status: 400 });
  }
  if (!isValidBusinessTimeZone(digestTimeZone)) {
    return NextResponse.json({ error: 'Select a valid IANA timezone.' }, { status: 400 });
  }
  if (!Number.isInteger(digestHour) || digestHour < 0 || digestHour > 23) {
    return NextResponse.json({ error: 'Digest hour must be between 0 and 23.' }, { status: 400 });
  }
  if (!Number.isInteger(digestWeeklyDay) || digestWeeklyDay < 0 || digestWeeklyDay > 6) {
    return NextResponse.json({ error: 'Digest weekday must be between Sunday and Saturday.' }, { status: 400 });
  }
  try {
    await saveXeroReconciliationEmailSettings({
      businessId: databaseId!, recipients, digestFrequency, digestTimeZone, digestHour, digestWeeklyDay,
    });
    return NextResponse.json({ success: true, settings: { recipients, digestFrequency, digestTimeZone, digestHour, digestWeeklyDay } });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: databaseId, source: 'xero_reconciliation', operation: 'save_email_settings',
      title: 'Xero reconciliation email settings could not be saved', error,
    });
    return NextResponse.json({ error: 'Reconciliation email settings could not be saved.' }, { status: 500 });
  }
}