import { NextResponse } from 'next/server';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import type { ActiveWholesaleSession } from './wholesaleSession';
import { parseWholesalePortalSettings, WHOLESALE_PORTAL_SETTING_KEYS } from './wholesalePortalSettings';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';

export async function requireWholesaleDraftWriteAccess(session: ActiveWholesaleSession): Promise<NextResponse | null> {
  if (!session.preview) return null;
  if (session.preview.mode !== 'ims_draft_test') {
    return NextResponse.json({ error: 'Staff preview is read-only.', code: 'wholesale_preview_read_only' }, { status: 403 });
  }
  const rows = await runImsForBusiness(session.businessId, () => imsQuery<{ value: string }>(
    'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
    [session.businessId, WHOLESALE_PORTAL_SETTING_KEYS.staffPreviewMode],
  ));
  const current = parseWholesalePortalSettings({
    [WHOLESALE_PORTAL_SETTING_KEYS.staffPreviewMode]: rows[0]?.value,
  });
  if (current.staffPreviewMode !== 'ims_draft_test') {
    return NextResponse.json({ error: 'Test checkout has been disabled in wholesale settings.', code: 'wholesale_preview_capability_revoked' }, { status: 403 });
  }
  return null;
}

export function previewDraftWhere(session: ActiveWholesaleSession, alias = 'o'): { sql: string; params: unknown[] } {
  if (session.preview) {
    return {
      sql: ` AND ${alias}.is_staff_preview_test = 1 AND ${alias}.staff_preview_session_id = ?`,
      params: [session.preview.previewSessionId],
    };
  }
  return { sql: ` AND ${alias}.is_staff_preview_test = 0`, params: [] };
}

export async function auditWholesalePreviewDraft(
  session: ActiveWholesaleSession,
  action: 'staff_test_draft_created' | 'staff_test_draft_updated' | 'staff_test_draft_deleted',
  draftId: number,
): Promise<void> {
  if (!session.preview) return;
  await imsExecute(
    `INSERT INTO ims_wholesale_team_events
       (business_id, company_id, actor_name, target_member_id, target_contact_id, target_name, target_email, action, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [session.businessId, session.companyId, `${session.preview.actorName} (${session.preview.actorEmail})`,
      session.memberId, session.contactId, session.name || session.email, session.email, action,
      JSON.stringify({ previewSessionId: session.preview.previewSessionId, wholesaleDraftId: draftId })],
  );
}
