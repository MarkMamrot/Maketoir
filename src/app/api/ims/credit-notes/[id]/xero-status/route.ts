import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';
import { query } from '@/services/MySQLService';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId = session.businessId as string;
  const cnId = Number(params.id);
  if (isNaN(cnId)) return NextResponse.json({ error: 'Invalid credit note id' }, { status: 400 });

  const cn = await ImsCNRepo.get(cnId, businessId).catch(() => null);
  if (!cn) return NextResponse.json({ error: 'Credit note not found' }, { status: 404 });

  const rows = await query<{ status: 'success' | 'error' | 'skipped'; detail: string | null; created_at: string; xero_id: string | null; sync_type: string }>(
    `SELECT status, detail, created_at, xero_id, sync_type
       FROM xero_sync_log
      WHERE business_id = ?
        AND sync_type IN ('cn_credit_note', 'cn_credit_note_void')
        AND reference_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [businessId, cnId],
  ).catch(() => []);

  return NextResponse.json({ success: true, latest: rows[0] ?? null });
}
