import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo } from '@/lib/ims/ImsRepository';
import { query } from '@/services/MySQLService';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const scnId = Number(params.id);
  if (isNaN(scnId)) return NextResponse.json({ error: 'Invalid supplier credit note id' }, { status: 400 });

  const scn = await ImsSupplierCNRepo.get(scnId, businessId).catch(() => null);
  if (!scn) return NextResponse.json({ error: 'Supplier credit note not found' }, { status: 404 });

  const rows = await query<{ status: 'success' | 'error' | 'skipped'; detail: string | null; created_at: string; xero_id: string | null }>(
    `SELECT status, detail, created_at, xero_id
       FROM xero_sync_log
      WHERE business_id = ?
        AND sync_type = 'scn_credit_note'
        AND reference_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [businessId, scnId],
  ).catch(() => []);

  return NextResponse.json({ success: true, latest: rows[0] ?? null });
}
