import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { getXeroReconciliationRecipients, getXeroReconciliationEmailSettings, saveXeroReconciliationRecipients } from '@/lib/xero/reconciliation/repository';
import { parseReconciliationRecipients } from '@/lib/xero/reconciliation/email';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const { user, response } = requireAdminTier();
  if (response) return response;
  try {
    return NextResponse.json({ recipients: await getXeroReconciliationRecipients(user.businessId) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: user.businessId, source: 'accounts_settings', operation: 'load_recipients', title: 'Accounts email settings could not be loaded', error });
    return NextResponse.json({ error: 'Accounts email settings could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const body = await request.json().catch(() => null);
  if (!body || (typeof body.recipients !== 'string' && !Array.isArray(body.recipients))) {
    return NextResponse.json({ error: 'Provide accounts email recipients.' }, { status: 400 });
  }
  const { recipients, invalid } = parseReconciliationRecipients(body.recipients);
  if (invalid.length || recipients.length > 20) {
    return NextResponse.json({ error: 'Enter valid email addresses, with at most 20 recipients.' }, { status: 400 });
  }
  try {
    if (!recipients.length && (await getXeroReconciliationEmailSettings(user.businessId)).digestFrequency !== 'off') {
      return NextResponse.json({ error: 'Turn off scheduled accounts digests before removing all recipients.' }, { status: 400 });
    }
    await saveXeroReconciliationRecipients({ businessId: user.businessId, recipients });
    return NextResponse.json({ success: true, recipients });
  } catch (error) {
    await reportRuntimeIssue({ businessId: user.businessId, source: 'accounts_settings', operation: 'save_recipients', title: 'Accounts email settings could not be saved', error });
    return NextResponse.json({ error: 'Accounts email settings could not be saved.' }, { status: 500 });
  }
}
