import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/app/api/ims/import/_helpers';
import { syncStocktakeJournal } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

export async function POST(req: NextRequest) {
  try {
    const session = getImportSession();
    if (!session?.business_id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { stocktakeId } = await req.json();
    if (!stocktakeId) return NextResponse.json({ error: 'stocktakeId required' }, { status: 400 });

    const result = await syncStocktakeJournal(session.business_id, Number(stocktakeId));
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
