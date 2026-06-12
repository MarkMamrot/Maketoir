import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosReportsRepo } from '@/lib/db/PosRepository';

function getAnySession() {
  const raw = cookies().get('pos_session')?.value ?? cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/reports/daily?location_id=3&date=2025-06-02
export async function GET(req: Request) {
  if (!getAnySession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const session = getAnySession();
  const locationId = parseInt(searchParams.get('location_id') ?? String(session?.location_id ?? 0), 10);
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  if (!locationId) return NextResponse.json({ error: 'location_id required.' }, { status: 400 });

  const transactions = await PosReportsRepo.dailyTransactions(locationId, date);

  // Summarise
  const totalRevenue = transactions.reduce((s, t) => s + t.sale.total, 0);
  const totalCount   = transactions.length;
  const byMethod: Record<string, number> = {};
  for (const t of transactions) {
    for (const p of t.payments) {
      byMethod[p.payment_method] = (byMethod[p.payment_method] ?? 0) + p.amount;
    }
  }

  return NextResponse.json({ transactions, summary: { total_revenue: totalRevenue, total_count: totalCount, by_method: byMethod } });
}
