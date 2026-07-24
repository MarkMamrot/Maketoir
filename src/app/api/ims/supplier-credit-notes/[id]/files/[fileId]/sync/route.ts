import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo, ImsSupplierCNFilesRepo } from '@/lib/ims/ImsRepository';
import { syncSupplierCNAttachmentsToXero } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

function extractValue(detail: string, key: string): string | null {
  const m = detail.match(new RegExp(`${key}=([^;]*)`));
  return m ? m[1] : null;
}

export async function POST(_: Request, { params }: { params: { id: string; fileId: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const scnId = Number(params.id);
  const fileId = Number(params.fileId);
  if (isNaN(scnId) || isNaN(fileId)) {
    return NextResponse.json({ error: 'Invalid supplier credit note file id' }, { status: 400 });
  }

  const scn = await ImsSupplierCNRepo.get(scnId, session.businessId).catch(() => null);
  if (!scn) return NextResponse.json({ error: 'Supplier credit note not found' }, { status: 404 });
  if (!scn.xero_credit_note_id) {
    return NextResponse.json({ error: 'Supplier credit note is not synced to Xero yet.' }, { status: 400 });
  }

  const file = await ImsSupplierCNFilesRepo.get(fileId, session.businessId).catch(() => null);
  if (!file || Number(file.scn_id) !== scnId) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  try {
    await syncSupplierCNAttachmentsToXero(
      session.businessId,
      scnId,
      scn.scn_number,
      scn.xero_credit_note_id,
      [file.filename],
    );

    const logs = await query<{ status: 'success' | 'error' | 'skipped'; detail: string | null; created_at: string }>(
      `SELECT status, detail, created_at
         FROM xero_sync_log
        WHERE business_id = ?
          AND sync_type = 'scn_attachment'
          AND reference_id = ?
          AND detail LIKE ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [session.businessId, scnId, `%file=${file.filename};%`],
    ).catch(() => []);

    const latest = logs[0];
    if (latest && latest.status !== 'success') {
      const detail = String(latest.detail ?? '');
      const message = extractValue(detail, 'message') || detail || 'Xero attachment upload failed.';
      const needsReconnect = /accounting\.attachments|unauthorized|AuthorizationUnsuccessful/i.test(message);
      return NextResponse.json(
        {
          success: false,
          error: needsReconnect
            ? 'Xero rejected attachment upload. Reconnect Xero in Setup > Connections to grant accounting.attachments, then retry.'
            : message,
          detail: message,
          needsReconnect,
          at: latest.created_at,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Xero upload failed.' }, { status: 500 });
  }
}
