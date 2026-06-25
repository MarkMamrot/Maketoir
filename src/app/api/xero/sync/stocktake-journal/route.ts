import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncStocktakeJournal } from '@/services/XeroSyncService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  try {
    const { databaseId, stocktakeId } = await req.json();
    if (!stocktakeId) return NextResponse.json({ error: 'stocktakeId required' }, { status: 400 });
    if (!databaseId)  return NextResponse.json({ error: 'databaseId required' },  { status: 400 });

    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;

    const result = await syncStocktakeJournal(databaseId, Number(stocktakeId));
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
