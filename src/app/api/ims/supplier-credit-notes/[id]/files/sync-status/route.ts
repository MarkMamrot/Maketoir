import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo, ImsSupplierCNFilesRepo } from '@/lib/ims/ImsRepository';
import { query } from '@/services/MySQLService';

function extractValue(detail: string, key: string): string | null {
  const m = detail.match(new RegExp(`${key}=([^;]*)`));
  return m ? m[1] : null;
}

function parseLog(detail: string) {
  const message = extractValue(detail, 'message') ?? detail;
  const needsReconnect = /accounting\.attachments|unauthorized|AuthorizationUnsuccessful/i.test(message);
  return { message, needsReconnect };
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const scnId = Number(params.id);
  if (isNaN(scnId)) return NextResponse.json({ error: 'Invalid supplier credit note id' }, { status: 400 });

  const scn = await ImsSupplierCNRepo.get(scnId, session.businessId).catch(() => null);
  if (!scn) return NextResponse.json({ error: 'Supplier credit note not found' }, { status: 404 });

  const files = await ImsSupplierCNFilesRepo.list(scnId, session.businessId).catch(() => []);
  const statusByFilename: Record<string, { status: 'success' | 'error' | 'skipped' | 'pending' | 'not_synced'; detail?: string; message?: string; needsReconnect?: boolean; at?: string }> = {};

  if (!scn.xero_credit_note_id) {
    for (const f of files) {
      statusByFilename[f.filename] = {
        status: (scn.xero_sync_status === 'queued' || scn.xero_sync_status === 'error') ? 'pending' : 'not_synced',
      };
    }
    return NextResponse.json({ success: true, statusByFilename });
  }

  const logs = await query<{ status: 'success' | 'error' | 'skipped'; detail: string | null; created_at: string }>(
    `SELECT status, detail, created_at
       FROM xero_sync_log
      WHERE business_id = ?
        AND sync_type = 'scn_attachment'
        AND reference_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 500`,
    [session.businessId, scnId],
  ).catch(() => []);

  for (const log of logs) {
    const detail = String(log.detail ?? '');
    const file = extractValue(detail, 'file');
    if (!file) continue;
    if (statusByFilename[file]) continue;
    const parsed = parseLog(detail);
    statusByFilename[file] = {
      status: log.status,
      detail,
      message: parsed.message,
      needsReconnect: parsed.needsReconnect,
      at: log.created_at,
    };
  }

  for (const f of files) {
    if (!statusByFilename[f.filename]) {
      statusByFilename[f.filename] = { status: 'pending' };
    }
  }

  return NextResponse.json({ success: true, statusByFilename });
}
